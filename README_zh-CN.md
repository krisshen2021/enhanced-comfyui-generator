# Enhanced ComfyUI 生成器

## 概述

**Enhanced ComfyUI Generator (ECG)** 是一个为 SillyTavern 设计的强大后端扩展，它提供了一个集中式、高性能的服务，用于通过 ComfyUI 生成图像和视频。它被设计为其他扩展的依赖项，提供一个稳定而强大的 API 来处理复杂的生成任务。

ECG 的核心特性是其智能的任务管理系统，它解决了常见的并发和性能问题，使其成为任何需要可靠、多实例图像生成能力的扩展的必备工具。

## 主要功能

- **集中式任务调度器**: 强大的“任务池”和“中央轮询循环”架构，能够可靠地管理并发生成请求，防止竞争条件，并确保每个任务都能完成。
- **多 ComfyUI 实例支持**:
    - 可配置两个独立的 ComfyUI 服务器 URL（例如，一个用于快速的 SDXL Turbo 模型，另一个用于较慢的视频模型）。
    - 扩展的 API 会根据任务类型 (`genType`) 智能地将生成请求路由到相应的服务器。
    - 这消除了模型加载延迟，并极大地提高了链式工作流（如 `txt2img` -> `img2vid`）的性能。
- **开发者友好的 API**:
    - 提供一个简单的基于 DOM 事件的 API (`st:comfyui:generate`)，供其他扩展请求生成。
    - 在内部管理所有排队、轮询和结果处理的复杂性。
    - 通过一个简单的 `onComplete` 回调函数返回结果。
- **动态工作流管理**:
    - **工作流编辑器**: 一个基于 LiteGraph.js 的强大集成编辑器，可直接在 SillyTavern 中修改和测试您的 ComfyUI 工作流。
    - **自动发现**: 扩展会自动扫描并管理您的 ComfyUI 工作流文件 (`.json`)。
    - **动态占位符系统**: 在运行时自动替换工作流中的占位符，如 `%prompt%`, `%width%`, `%height%`, `%seed%`, `%time_stamp%` 和 `%image_name%`。
- **强大的错误处理**: 内部任务调度器旨在优雅地处理 API 错误和超时。

## 安装

本扩展设计为通过 SillyTavern 的扩展管理器直接从其 Git 仓库安装。

1.  **导航到下载选项卡**: 打开 SillyTavern 并转到“下载”选项卡（云图标）。
2.  **安装扩展**: 在“安装扩展”部分，将以下仓库 URL 粘贴到文本字段中：
    ```
    https://github.com/your-username/enhanced-comfyui-generator.git
    ```
    *(请将其替换为您的实际仓库 URL)*
3.  **点击“安装”**: 扩展将被自动下载并安装。
4.  **启用扩展**: 转到“扩展”选项卡（拼图图标），在列表中找到“Enhanced ComfyUI Generator”，并勾选“启用”框。
5.  **重新加载 UI**: 需要重新加载 UI 才能使扩展生效。

## 配置

1.  **导航到扩展面板**: 在设置列表中找到“Enhanced ComfyUI Generator”。
2.  **ComfyUI API URL**:
    - **主 URL**: 设置您的主 ComfyUI 实例的 URL。这用于常规任务。
    - **视频/备用 URL (可选)**: 设置第二个 ComfyUI 实例的 URL。强烈建议为 `img2vid` 任务设置此项，以避免缓慢的模型重新加载。
3.  **工作流管理**:
    - 使用“管理工作流”按钮打开工作流编辑器。
    - 创建新工作流或导入现有工作流。
    - 确保您的工作流具有正确的占位符，以便生成器正常工作。

## 开发者 API

要从您自己的扩展中使用 ECG，请在 `document` 上派发一个 `CustomEvent`。

**事件名称**: `st:comfyui:generate`

**事件 `detail` 对象参数**:

| 参数 | 类型 | 必须 | 描述 |
|---|---|---|---|
| `workflowName` | `string` | 是 | 要使用的工作流的文件名 (例如, `sdxl_turbo.json`)。 |
| `prompt` | `string` | 是 | 正向提示词文本。 |
| `onComplete` | `function` | 是 | 回调函数: `(finalUrl, error, messageId) => {}`。 |
| `messageId` | `any` | 是 | 消息或上下文的唯一标识符，会在 `onComplete` 回调中传回。 |
| `genType` | `string` | 否 | 如果设置为 `img2img`，请求将被路由到备用/视频 URL。 |
| `inputImageUrl` | `string` | 否 | 输入图像的 URL。用于替换工作流中的 `%input_image_url%` 占位符。 |
| `width` | `number` | 否 | 期望的宽度。替换 `%width%`。 |
| `height` | `number` | 否 | 期望的高度。替换 `%height%`。 |
| `characterName` | `string` | 否 | 角色的名称，会在 `onComplete` 回调中传回以提供上下文。 |

### 使用示例

```javascript
// 您的扩展代码
function triggerGeneration(prompt, messageId) {
    const onGenerationComplete = (finalUrl, error, returnedMessageId) => {
        if (error) {
            console.error(`为消息 ${returnedMessageId} 生成失败:`, error);
            return;
        }
        console.log(`成功！消息 ${returnedMessageId} 的图像位于: ${finalUrl}`);
        // 您显示图像的逻辑
    };

    document.dispatchEvent(new CustomEvent('st:comfyui:generate', {
        detail: {
            workflowName: 'my_workflow.json',
            prompt: prompt,
            messageId: messageId,
            onComplete: onGenerationComplete,
            width: 1024,
            height: 1024,
        }
    }));
}
```
