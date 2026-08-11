targetScope = 'resourceGroup'

param location string = resourceGroup().location
param appName string
param containerEnvironmentId string
param registryLoginServer string
param workloadIdentityId string
param workloadIdentityClientId string
param containerImage string
param environmentName string = 'dev'
param capacityDatabaseHost string
param capacityDatabaseName string = 'capacity_tracker'
param attendanceDatabaseHost string
param attendanceDatabaseName string = 'attendance'
param databaseUser string

resource capacityApp 'Microsoft.App/containerApps@2026-01-01' = {
  name: appName
  location: location
  tags: {
    application: 'Skills4 Capacity Tracker'
    environment: environmentName
    sourceAttendanceAccess: 'ReadOnly'
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${workloadIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 8000
        transport: 'Auto'
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: registryLoginServer
          identity: workloadIdentityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'capacity-tracker'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'CAPACITY_ENVIRONMENT'
              value: environmentName
            }
            {
              name: 'CAPACITY_DATABASE_MODE'
              value: 'live'
            }
            {
              name: 'CAPACITY_AZURE_CLIENT_ID'
              value: workloadIdentityClientId
            }
            {
              name: 'CAPACITY_CAPACITY_DATABASE_HOST'
              value: capacityDatabaseHost
            }
            {
              name: 'CAPACITY_CAPACITY_DATABASE_NAME'
              value: capacityDatabaseName
            }
            {
              name: 'CAPACITY_CAPACITY_DATABASE_USER'
              value: databaseUser
            }
            {
              name: 'CAPACITY_ATTENDANCE_DATABASE_HOST'
              value: attendanceDatabaseHost
            }
            {
              name: 'CAPACITY_ATTENDANCE_DATABASE_NAME'
              value: attendanceDatabaseName
            }
            {
              name: 'CAPACITY_ATTENDANCE_DATABASE_USER'
              value: databaseUser
            }
            {
              name: 'CAPACITY_FORECAST_MONTHS'
              value: '18'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 8000
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: 8000
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 2
        rules: [
          {
            name: 'http-scale'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

output fqdn string = capacityApp.properties.configuration.ingress.fqdn
