// ═══════════════════════════════════════════
//  NEXUS CRM — Enabled Modules Registry
//  ═══════════════════════════════════════════
//  Tenant-level feature toggle for modules.
//  Fields with dependsOnModule set will be
//  hidden when the module is not in this list.
//  ═══════════════════════════════════════════

// Currently active modules — update per tenant
const enabledModules: string[] = [
  'contacts',
  'companies',
  'tasks',
  'touchpoints',
  'projects',
]

export function isModuleEnabled(name: string): boolean {
  return enabledModules.includes(name)
}

export function getEnabledModules(): string[] {
  return [...enabledModules]
}

export default enabledModules
