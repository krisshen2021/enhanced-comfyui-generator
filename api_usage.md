# SillyTavern API 认证与使用指南

本文档旨在记录在 SillyTavern 扩展中如何正确地进行需要登录认证的 API 调用，特别是文件上传。

## 核心认证机制

SillyTavern 的后端 API 通过两种机制保护需要认证的接口：

1.  **Session Cookie**：用户登录后，浏览器会自动存储。在后续的请求中，浏览器会自动带上这个 Cookie 来证明用户的登录状态。我们通常无需手动处理。
2.  **CSRF Token**：为了防止跨站请求伪造（CSRF）攻击，所有需要认证的、会修改数据的请求（如 POST, PUT, DELETE 等）都必须在 HTTP Header 中包含一个 CSRF Token。

因此，任何需要认证的请求，都必须**同时**携带有效的 Session Cookie 和 CSRF Token。

## 正确的调用方式：`getRequestHeaders()`

SillyTavern 的前端 `script.js` 中已经为我们封装好了一个非常重要的辅助函数：

```javascript
getRequestHeaders(options)
```

这个函数会自动获取当前有效的 CSRF Token 并构建好标准的请求头。**我们应该始终使用这个函数来确保 API 调用的正确性和未来的兼容性。**

### 示例 1：发送普通 JSON 数据

当你需要向后端发送 JSON 数据时，可以直接使用 `getRequestHeaders()`。

```javascript
async function postSomeData(data) {
    const response = await fetch('/api/some-endpoint', {
        method: 'POST',
        headers: getRequestHeaders(), // 直接调用，会自动包含 Content-Type: application/json
        body: JSON.stringify(data),
    });

    if (!response.ok) {
        // ... 错误处理
    }
}
```

### 示例 2：上传文件（使用 FormData）

文件上传是一个特殊情况。我们需要使用 `FormData` 对象，并且**必须让浏览器自己来设置 `Content-Type`**。

为此，我们需要给 `getRequestHeaders` 传递一个关键参数：

```javascript
{ omitContentType: true }
```

-   **作用**：这个参数告诉函数在生成的请求头中**不要**包含 `Content-Type` 字段。
-   **原因**：当 `fetch` 的 `body` 是 `FormData` 时，浏览器会自动生成正确的 `Content-Type: multipart/form-data; boundary=...`。如果请求头中手动设置了 `Content-Type`，就会缺少这个由浏览器随机生成的、至关重要的 `boundary` 字符串，导致服务器无法解析上传的文件。

```javascript
async function uploadFile(fileObject) {
    const formData = new FormData();
    // 'avatar' 是后端接口定义的字段名，需要根据实际情况修改
    formData.append('avatar', fileObject); 

    const response = await fetch('/api/character/upload', {
        method: 'POST',
        // 关键：使用 omitContentType: true
        headers: getRequestHeaders({ omitContentType: true }),
        body: formData,
    });

    if (!response.ok) {
        // ... 错误处理
    }
}
```

## 总结

-   任何需要认证的 API 调用，都请使用 `getRequestHeaders()` 来构建请求头。
-   如果是上传文件（使用 `FormData`），请务必附带 `{ omitContentType: true }` 参数。
