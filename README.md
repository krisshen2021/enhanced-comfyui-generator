# Enhanced ComfyUI Generator

[![](https://img.shields.io/badge/language-简体中文-blue.svg)](./README_zh-CN.md)

## Overview

The **Enhanced ComfyUI Generator (ECG)** is a robust backend extension for SillyTavern that provides a centralized, high-performance service for generating images and videos via ComfyUI. It is designed to be used as a dependency by other extensions, offering a stable and powerful API to handle complex generation tasks.

ECG's core feature is its intelligent task management system, which solves common concurrency and performance issues, making it an essential tool for any extension that needs reliable, multi-instance image generation capabilities.

## Key Features

- **Centralized Task Scheduler**: A powerful "task pool" and "central polling loop" architecture that reliably manages concurrent generation requests, preventing race conditions and ensuring every job completes.
- **Multi-Instance ComfyUI Support**:
    - Configure two separate ComfyUI server URLs (e.g., one for fast SDXL Turbo models, another for slower video models).
    - The extension's API intelligently routes generation requests to the appropriate server based on the task type (`genType`).
    - This eliminates model-loading delays and dramatically improves performance for chained workflows (like `txt2img` -> `img2vid`).
- **Developer-Friendly API**:
    - Provides a simple DOM event-based API (`st:comfyui:generate`) for other extensions to request generations.
    - Manages all the complexity of queueing, polling, and result handling internally.
    - Returns results via a simple `onComplete` callback.
- **Dynamic Workflow Management**:
    - **Workflow Editor**: A powerful, integrated editor based on LiteGraph.js to modify, and test your ComfyUI workflows directly within SillyTavern.
    - **Automatic Discovery**: The extension automatically scans for and manages your ComfyUI workflow files (`.json`).
    - **Dynamic Placeholder System**: Automatically replaces placeholders like `%prompt%`, `%width%`, `%height%`, `%seed%`, `%timestamp%` and `%image_name%` in your workflows at runtime.
- **Robust Error Handling**: The internal task scheduler is designed to handle API errors and timeouts gracefully.

## Installation

This extension is designed to be installed directly from its Git repository using the SillyTavern extension manager.

1.  **Navigate to the Downloads Tab**: Open SillyTavern and go to the "Downloads" tab (cloud icon).
2.  **Install Extension**: Under the "Install Extensions" section, paste the following repository URL into the text field:
    ```
    https://github.com/krisshen2021/enhanced-comfyui-generator.git
    ```
3.  **Click "Install"**: The extension will be downloaded and installed automatically.
4.  **Enable the Extension**: Go to the "Extensions" tab (puzzle piece icon), find "Enhanced ComfyUI Generator" in the list, and check the "Enabled" box.
5.  **Reload the UI**: A UI reload is required for the extension to become active.

## Configuration

1.  **Navigate to the Extensions Panel**: Find "Enhanced ComfyUI Generator" in the settings list.
2.  **ComfyUI API URLs**:
    - **Primary URL**: Set the URL for your main ComfyUI instance. This is used for general tasks.
    - **Video/Secondary URL (Optional)**: Set the URL for a second ComfyUI instance. This is highly recommended for `img2vid` tasks to avoid slow model reloads.
3.  **Workflow Management**:
    - Use the "Manage Workflows" button to open the workflow editor.
    - Create new workflows or import existing ones.
    - Ensure your workflows have the correct placeholders for the generator to function.

## API for Developers

To use ECG from your own extension, dispatch a `CustomEvent` on the `document`.

**Event Name**: `st:comfyui:generate`

**Event `detail` Object Parameters**:

| Parameter       | Type       | Required | Description                                                                                             |
|-----------------|------------|----------|---------------------------------------------------------------------------------------------------------|
| `workflowName`  | `string`   | Yes      | The filename of the workflow to use (e.g., `sdxl_turbo.json`).                                          |
| `prompt`        | `string`   | Yes      | The positive prompt text.                                                                               |
| `onComplete`    | `function` | Yes      | A callback function: `(finalUrl, error, messageId) => {}`.                                               |
| `messageId`     | `any`      | Yes      | A unique identifier for the message or context, passed back in the `onComplete` callback.               |
| `genType`       | `string`   | No       | If set to `img2img`, the request will be routed to the secondary/video URL.                               |
| `inputImageUrl` | `string`   | No       | The URL of an input image. Used to replace the `%input_image_url%` placeholder in the workflow.         |
| `width`         | `number`   | No       | The desired width. Replaces `%width%`.                                                                  |
| `height`        | `number`   | No       | The desired height. Replaces `%height%`.                                                                |
| `characterName` | `string`   | No       | The character's name, passed back in the `onComplete` callback for context.                             |

### Example Usage

```javascript
// Your extension's code
function triggerGeneration(prompt, messageId) {
    const onGenerationComplete = (finalUrl, error, returnedMessageId) => {
        if (error) {
            console.error(`Generation failed for message ${returnedMessageId}:`, error);
            return;
        }
        console.log(`Success! Image for message ${returnedMessageId} is at: ${finalUrl}`);
        // Your logic to display the image
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
