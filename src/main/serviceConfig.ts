// Re-export from service module — safe to import in Electron main (no Electron APIs used)
export { CONFIG_PATH, loadOrCreateConfig } from '../service/serviceConfig'
