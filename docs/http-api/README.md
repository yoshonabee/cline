# Cline HTTP API

Cline HTTP API 提供了一個 HTTP 介面，讓您能夠通過 HTTP 請求與 Cline 進行互動。這個 API 允許您創建任務、執行工具、查詢任務狀態等操作。

## 啟用 HTTP 服務器

預設情況下，HTTP 服務器是停用的。您需要在 VS Code 的設定中啟用它：

1. 打開 VS Code 設定 (Cmd/Ctrl + ,)
2. 搜尋 "cline.http"
3. 設定以下選項：
   ```json
   {
     "cline.http.enabled": true,    // 啟用 HTTP 服務器
     "cline.http.port": 3000,       // 設定服務器端口（可選）
     "cline.http.authRequired": true // 是否需要認證（建議啟用）
   }
   ```

## 認證

### 獲取 Token

有兩種方式可以獲取認證 Token：

1. **使用 VS Code 命令（推薦）**
   - 打開命令面板 (Cmd/Ctrl + Shift + P)
   - 輸入 `Cline: Generate HTTP Token`
   - Token 會自動複製到剪貼板

2. **通過 API 端點**（僅限本地訪問）
   ```http
   GET http://localhost:3000/api/token
   ```
   
   回應範例：
   ```json
   {
     "token": "eyJhbGciOiJIUzI1NiIs...",
     "expiresAt": 1679529600000
   }
   ```

### 使用 Token

在所有需要認證的請求中，將 token 加入 HTTP Header：

```http
Authorization: Bearer <your-token>
```

## API 端點

### 1. 健康檢查

檢查服務器是否正常運行。

```http
GET /api/status
```

回應範例：
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

### 2. 任務管理

#### 創建新任務

```http
POST /api/tasks/new
Authorization: Bearer <your-token>
Content-Type: application/json

{
  "text": "任務描述",
  "images": ["可選的圖片數組"]
}
```

回應範例：
```json
{
  "taskId": "task-123",
  "status": "created"
}
```

#### 獲取任務狀態

```http
GET /api/tasks/:id
Authorization: Bearer <your-token>
```

回應範例：
```json
{
  "taskId": "task-123",
  "status": "completed",
  "messages": []
}
```

### 3. 工具執行

執行特定的工具。

```http
POST /api/tools/execute
Authorization: Bearer <your-token>
Content-Type: application/json

{
  "tool": "工具名稱",
  "params": {
    "參數名稱": "參數值"
  }
}
```

回應範例：
```json
{
  "result": {
    "message": "工具執行結果"
  },
  "status": "success"
}
```

## 錯誤處理

API 使用標準的 HTTP 狀態碼：

| 狀態碼 | 說明 |
|--------|------|
| 200 | 成功 |
| 201 | 創建成功 |
| 400 | 請求錯誤 |
| 401 | 未認證 |
| 403 | 無權限 |
| 404 | 資源不存在 |
| 500 | 服務器錯誤 |

錯誤回應格式：
```json
{
  "error": "錯誤描述"
}
```

## 安全性考慮

1. **本地訪問限制**
   - Token 生成只能從本地（localhost）進行
   - 建議只在本地網路中使用此 API

2. **認證機制**
   - 所有 API 請求都需要有效的 JWT Token（除非在設定中停用）
   - Token 有效期預設為 24 小時

3. **安全中間件**
   - 使用 CORS 限制跨域請求
   - 使用 Helmet 增強 HTTP 安全性

## 使用範例

### cURL

```bash
# 獲取 token（本地）
curl http://localhost:3000/api/token

# 創建任務
curl -X POST http://localhost:3000/api/tasks/new \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "建立新的 React 組件"}'

# 檢查任務狀態
curl http://localhost:3000/api/tasks/task-123 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Python

```python
import requests

base_url = "http://localhost:3000"
token = "YOUR_TOKEN"
headers = {"Authorization": f"Bearer {token}"}

# 創建任務
response = requests.post(
    f"{base_url}/api/tasks/new",
    headers=headers,
    json={"text": "建立新的 React 組件"}
)
task_id = response.json()["taskId"]

# 檢查任務狀態
status = requests.get(
    f"{base_url}/api/tasks/{task_id}",
    headers=headers
)
print(status.json())
```

### Node.js

```javascript
const axios = require('axios');

const baseURL = 'http://localhost:3000';
const token = 'YOUR_TOKEN';
const headers = { Authorization: `Bearer ${token}` };

// 創建任務
async function createTask() {
  const response = await axios.post(
    `${baseURL}/api/tasks/new`,
    { text: '建立新的 React 組件' },
    { headers }
  );
  return response.data.taskId;
}

// 檢查任務狀態
async function checkTaskStatus(taskId) {
  const response = await axios.get(
    `${baseURL}/api/tasks/${taskId}`,
    { headers }
  );
  return response.data;
}
```

## 常見問題

### Q: 如何重新生成 Token？
A: 使用 VS Code 命令面板執行 `Cline: Generate HTTP Token` 命令即可生成新的 Token。

### Q: 為什麼無法從遠端訪問 API？
A: 出於安全考慮，Token 生成和某些 API 端點僅允許從 localhost 訪問。如果需要遠端訪問，請確保正確設定了安全措施。

### Q: Token 過期了怎麼辦？
A: Token 有效期為 24 小時，過期後需要重新生成新的 Token。
