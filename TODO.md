# TODO: 修复 LiteGraph.js 编辑器窗口缩放问题

## 问题描述

当前，当用户缩放浏览器窗口时，`LiteGraph.js` 编辑器会出现严重的渲染问题：

1.  **内容变形**: 画布内的所有节点、文字和连线都会被不成比例地拉伸或压缩，导致显示变形。
2.  **鼠标坐标漂移**: 变形后，鼠标的点击位置与视觉上元素的位置不再匹配，无法准确选中或操作节点。

## 问题根源

这个问题是典型的 HTML Canvas 渲染问题。当仅使用 CSS 来改变 `<canvas>` 元素的尺寸时，浏览器会像对待 `<img>` 标签一样，将画布上已经绘制好的像素内容进行拉伸/压缩，而不会改变画布本身的内部坐标系分辨率。这导致了视觉变形和坐标系统不匹配。

## 解决方案

我们需要在窗口大小改变时，主动去更新 Canvas 对象的 `width` 和 `height` **属性**，并通知 `LiteGraph` 实例进行重绘。

### 实施步骤

1.  **监听窗口 `resize` 事件**: 在创建编辑器模态框 (`createWorkflowModal`) 或显示编辑器 (`showWorkflowEditor`) 时，需要绑定一个 `window.resize` 事件的监听器。
2.  **节流处理 (Debounce)**: 为了防止 `resize` 事件过于频繁触发导致性能问题，应该对事件处理函数进行节流（debounce）处理。
3.  **更新 Canvas 尺寸**: 在 `resize` 事件的处理函数中：
    a. 获取 Canvas 父容器（如 `.workflow-modal-body`）的当前实际宽度和高度。
    b. 将这些新的宽高值，赋给 `<canvas>` 元素的 `width` 和 `height` **属性** (e.g., `canvasElement.width = newWidth;`)。
    c. 调用 `LGraphCanvas` 实例的 `resize()` 方法，通知 LiteGraph 画布尺寸已改变。
4.  **重绘**: 调用 `LGraph` 实例的 `draw()` 或类似方法强制重绘整个图表。
5.  **清理监听器**: 在关闭编辑器 (`closeWorkflowEditor`) 时，务必移除绑定的 `window.resize` 事件监听器，以防止内存泄漏。
