# Enhanced ComfyUI Generator: 架构与开发者指南

本文档旨在详细阐述本扩展的内部架构、设计理念和工作流程，以便于未来的维护和二次开发。

## 1. 项目概述

本扩展的核心目标有两个：

1.  **可视化编辑器**: 提供一个基于 `LiteGraph.js` 的图形化界面，允许用户在 SillyTavern 内部直观地创建、编辑和手动测试 ComfyUI 工作流。
2.  **自动化 API**: 提供一个强大而灵活的事件驱动 API，供其他 SillyTavern 扩展调用，以实现程序化、自动化的图像/视频生成。

## 2. 架构设计：调度员与 Agent 模型

为了实现功能的清晰分离和高内聚、低耦合，我们采用了“调度员与 Agent”的设计模式。

- **`index.js` (调度员 / Controller)**: 作为扩展的入口和大脑，负责协调。
- **`workflow-editor.js` (设计专家 / Agent 1)**: 负责所有与可视化编辑相关的任务。
- **`workflow-executor.js` (自动化专家 / Agent 2)**: 负责所有后台的、自动化的工作流执行任务。

### 工作流程图

```
[其他扩展] --(触发 st:comfyui:generate 事件)--> [index.js (调度员)]
                                                     |
                                                     | 1. 接收事件, 合并配置
                                                     | 2. 进行预检验
                                                     v
                                     [workflow-executor.js (自动化专家)]
                                                     |
                                                     | 3. 执行完整的自动化流水线
                                                     |    (上传, 修改, 执行, 回传)
                                                     v
                                     [index.js (调度员)] --(调用 onComplete 回调)--> [其他扩展]


[用户点击 "打开编辑器"] --> [index.js (调度员)] --(调用)--> [workflow-editor.js (设计专家)]
                                                               |
                                                               | (用户点击 "测试运行")
                                                               v
                                                [workflow-executor.js (自动化专家)]
```

## 3. 模块详解

### `index.js` (调度员)

- **初始化**: 在 `jQuery(async () => { ... })` 中完成所有初始化。
- **模块加载**: 采用懒加载和单例模式，在需要时（如第一次打开编辑器或第一次触发API）通过 `loadModules()` 加载 `editor` 和 `executor` 模块，并将实例保存在全局变量中。
- **设置管理**:
    - `initSettings`: 初始化默认设置，并兼容旧版本。
    - `updateSettingsUI`: 将设置数据同步到 `settings.html` 的 UI 控件上。
    - `onSettingsChange`: 监听 UI 控件的变化，保存设置，并**实时调用 `updateApiBaseUrl()`** 将最新的 API 地址更新到已加载的后台模块中。
- **API 入口**:
    - 监听全局 DOM 事件 `st:comfyui:generate`。
    - `handleApiGenerate` 函数作为事件处理器，负责**配置合并**和**预检验**。

### `workflow-editor.js` (设计专家)

- **核心**: 基于 `LiteGraph.js` 实现。
- **解码 (`decodeComfyUIWorkflow`)**: 将 ComfyUI 的 JSON 对象转换为 LiteGraph 的节点数组。
- **编码 (`encodeToComfyUIWorkflow`)**: 将 LiteGraph 的节点数组转换回 ComfyUI 的 JSON 对象。
- **智能文本框方案**:
    - **解码时**: `inferWidgetType` 函数会将 `width`, `height`, `seed` 等特殊数字参数强制渲染为 `text` 类型的 Widget，允许用户输入占位符。
    - **编码时**: `encodeToComfyUIWorkflow` 函数会对这些特殊文本框的值进行智能判断：
        - 如果值是占位符 (如 `%width%`)，则保留为字符串。
        - 如果值是数字字符串 (如 `"512"`), 则转换为真实的 `Number` 类型。
        - 对需要整数的参数（如 `width`, `steps`）进行 `Math.round()` 处理。
        - 明确跳过 `type === 'button'` 的 Widget，防止其被错误地编码到 JSON 中。
- **手动测试**: `testWorkflowExecution` 函数负责手动测试流程。它调用 `executor` 模块的核心执行引擎，并提供一个 `onProgress` 回调来将实时进度更新到 UI 任务卡片上。

### `workflow-executor.js` (自动化专家)

- **职责**: 封装所有与后端（ComfyUI 和 SillyTavern）的交互，提供一个纯粹的、无 UI 的执行环境。
- **核心函数**:
    - `executeAutomatedWorkflow(options)`: 自动化流程的主入口。
    - `executeWorkflowInComfyUI(workflowJson, onProgress)`: 与 ComfyUI 交互的核心引擎，负责提交和轮询，可通过 `onProgress` 回调报告中间状态。
- **辅助函数**:
    - `modifyWorkflow(...)`: 负责占位符的替换。
    - `uploadImageToComfyUI(...)`: 负责将 SillyTavern 的图片上传到 ComfyUI。
    - `processAndUploadImage(...)`: 负责将 ComfyUI 生成的结果下载并上传回 SillyTavern。

## 4. 外部 API (`st:comfyui:generate`) 详解

- **事件名称**: `st:comfyui:generate`
- **触发方式**: `document.dispatchEvent(new CustomEvent('st:comfyui:generate', { detail: { ... } }));`
- **`detail` 对象参数**:
    - `onComplete` (Function, **必需**): 回调函数，格式为 `(finalUrl, error) => {}`。
    - `workflowName` (String, *可选*): 要使用的工作流名称。**如果未提供，则使用用户在设置中配置的默认工作流。**
    - `width` (Number, *可选*): 生成宽度。**如果未提供，则使用用户在设置中配置的默认宽度。**
    - `height` (Number, *可选*): 生成高度。**如果未提供，则使用用户在设置中配置的默认高度。**
    - `prompt` (String, *条件必需*): 提示词。如果目标工作流中包含 `%prompt%` 占位符，则此参数为必需。
    - `inputImageUrl` (String, *条件必需*): 输入图片的 SillyTavern 相对路径。如果目标工作流中包含 `%image_name%` 占位符，则此参数为必需。
    - `characterName` (String, *可选*): 角色名称，用于将最终生成物保存在该角色的文件夹下。

## 5. 工作流占位符约定

为了让自动化 API 能够正确地修改工作流，工作流的 JSON 源文件中必须使用以下**字符串**作为占位符：

-   `%prompt%`: 用于替换提示词。在节点的 `text` 或 `string` 输入中使用。
-   `%image_name%`: 用于替换 `LoadImage` 节点的输入图片文件名。
-   `"%width%"`: 用于替换宽度。**注意：必须包含引号**，因为它是用来替换一个 JSON 数字值的字符串。
-   `"%height%"`: 用于替换高度。**注意：必须包含引号**。

---
*文档创建于 2025-09-08*
