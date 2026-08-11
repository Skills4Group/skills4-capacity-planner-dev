targetScope = 'resourceGroup'

@description('Azure region for all Capacity Tracker resources.')
param location string = resourceGroup().location

@description('Short environment name used in tags and generated resource names.')
@allowed(['dev', 'test', 'prod'])
param environmentName string = 'dev'

@description('Globally unique lowercase prefix. Defaults to a deterministic value for this resource group.')
param resourcePrefix string = 's4cap${environmentName}${uniqueString(resourceGroup().id)}'

@description('Microsoft Entra object ID for the PostgreSQL administrator.')
param postgresEntraAdminObjectId string

@description('Microsoft Entra principal name for the PostgreSQL administrator.')
param postgresEntraAdminName string

var commonTags = {
  application: 'Skills4 Capacity Tracker'
  environment: environmentName
  dataClassification: 'Internal'
  sourceAttendanceAccess: 'ReadOnly'
}
var registryName = take(replace('${resourcePrefix}acr', '-', ''), 50)
var postgresName = take('${resourcePrefix}-pg', 63)
var environmentResourceName = take('${resourcePrefix}-env', 32)
var workspaceName = take('${resourcePrefix}-logs', 63)
var keyVaultName = take('${resourcePrefix}-kv', 24)
var identityName = take('${resourcePrefix}-identity', 128)
var keyVaultProperties = union(
  {
    tenantId: tenant().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    publicNetworkAccess: 'Enabled'
    sku: {
      family: 'A'
      name: 'standard'
    }
    accessPolicies: []
  },
  environmentName == 'prod' ? { enablePurgeProtection: true } : {}
)

resource logs 'Microsoft.OperationalInsights/workspaces@2025-07-01' = {
  name: workspaceName
  location: location
  tags: commonTags
  properties: {
    retentionInDays: 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
  sku: {
    name: 'PerGB2018'
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: registryName
  location: location
  tags: commonTags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
    policies: {
      quarantinePolicy: {
        status: 'disabled'
      }
      retentionPolicy: {
        days: 7
        status: 'disabled'
      }
      trustPolicy: {
        status: 'disabled'
        type: 'Notary'
      }
    }
  }
}

resource workloadIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
  tags: commonTags
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, workloadIdentity.id, 'AcrPull')
  scope: registry
  properties: {
    principalId: workloadIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '7f951dda-4ed3-4680-a7ca-43fe172d538d'
    )
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: keyVaultName
  location: location
  tags: commonTags
  properties: keyVaultProperties
}

resource containerEnvironment 'Microsoft.App/managedEnvironments@2026-01-01' = {
  name: environmentResourceName
  location: location
  tags: commonTags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: postgresName
  location: location
  tags: commonTags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenant().tenantId
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    storage: {
      autoGrow: 'Enabled'
      storageSizeGB: 32
    }
  }
}

resource postgresAdmin 'Microsoft.DBforPostgreSQL/flexibleServers/administrators@2025-08-01' = {
  parent: postgres
  name: postgresEntraAdminObjectId
  properties: {
    principalName: postgresEntraAdminName
    principalType: 'User'
    tenantId: tenant().tenantId
  }
}

resource capacityDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: postgres
  name: 'capacity_tracker'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2025-08-01' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

output registryName string = registry.name
output registryLoginServer string = registry.properties.loginServer
output containerEnvironmentId string = containerEnvironment.id
output workloadIdentityId string = workloadIdentity.id
output postgresServerName string = postgres.name
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output capacityDatabaseName string = capacityDatabase.name
output keyVaultName string = keyVault.name
