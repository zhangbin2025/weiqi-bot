/**
 * 宿主原生 Workflow 算子命名空间（唯一真相）。
 *
 * 这些命名空间由宿主在 OperatorRegistry 里以 hostOperators 形式注册，不对应
 * weiqi-assets 里的 workflow-operator 插件工件。技能安装器（推导在线插件依赖）
 * 与发布器（推导随技能发布的插件）必须共用这份集合：
 * 任一处在自己代码里另写一份排除清单，新增宿主命名空间时就会漂移——
 * storage.* 漏登记曾导致天气技能被要求安装不存在的 workflow-operator.storage，
 * 安装器随即「无法自动安装」放弃整次安装。
 *
 * 来源：application/plugin/HostWorkflowOperators.ts（json / regex）
 *       application/plugin/WorkflowStorageOperators.ts（storage）
 * 新增宿主算子命名空间时，先在这里登记，再补两处依赖推导的回归用例。
 */
export const HOST_WORKFLOW_OPERATOR_NAMESPACES: ReadonlySet<string> = new Set([
  'json',
  'regex',
  'storage',
]);
