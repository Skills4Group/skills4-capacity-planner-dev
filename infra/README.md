# Development infrastructure

`main.bicep` defines Capacity Tracker-owned platform resources in `Skills4-Capacity-Tracker-Dev`. `app.bicep` deploys the application only after an image has been built and pushed to the new registry.

The templates do not modify the Attendance Tool resource group or database. A separate, explicitly reviewed SQL grant will be required later to give the Capacity Tracker identity `SELECT` access to `public.learner_progress`.

These templates must be reviewed with an Azure `what-if` operation before deployment.

