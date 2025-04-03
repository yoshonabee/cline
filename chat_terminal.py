import requests
import json
import websocket
import threading
import time
import os
import traceback
from typing import Optional, Dict, Any, List, Callable

class WebSocketClient:
    def __init__(self, url: str, token: str):
        self.url = url
        self.token = token
        self.ws: Optional[websocket.WebSocketApp] = None
        self.messages: List[Dict[str, Any]] = []
        self.is_connected = False
        self.on_message_received: Optional[Callable[[str], None]] = None
        self._connect()

    def _connect(self):
        headers = {
            'Authorization': f'Bearer {self.token}'
        }
        self.ws = websocket.WebSocketApp(
            self.url,
            header=headers,
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close,
            on_open=self._on_open
        )
        self.ws_thread = threading.Thread(target=self.ws.run_forever)
        self.ws_thread.daemon = True
        self.ws_thread.start()

    def _on_message(self, ws, message):
        try:
            data = json.loads(message)
            
            # 處理一般消息
            if 'message' in data:
                msg = data['message']
                content = msg.get('content', '')
                msg_type = msg.get('type', '')
                timestamp = msg.get('timestamp', '')
                
                # 根據消息類型顯示不同格式
                if msg_type == 'user':
                    print(f"\n[{timestamp}] 你: {content}")
                elif msg_type == 'assistant':
                    print(f"\n[{timestamp}] AI: {content}")
                    if self.on_message_received:
                        self.on_message_received(msg_type)
                else:
                    print(f"\n[{timestamp}] {msg_type}: {content}")
                
                print("\n> ", end='', flush=True)
            
            # 處理狀態更新
            elif 'status' in data:
                status = data.get('status', '')
                if status:
                    print(f"\n系統: {status}")
                    print("\n> ", end='', flush=True)
            
            # 處理錯誤消息
            elif 'error' in data:
                error = data.get('error', '')
                if error:
                    print(f"\n錯誤: {error}")
                    print("\n> ", end='', flush=True)
            
            # 其他類型的消息
            else:
                print(f"\n收到未知類型的消息: {json.dumps(data, ensure_ascii=False)}")
                print("\n> ", end='', flush=True)
            
            # 保存消息以供後續使用
            self.messages.append(data)
            
        except json.JSONDecodeError:
            print(f"\n收到非 JSON 格式的消息: {message}")
            print("\n> ", end='', flush=True)
        except Exception as e:
            print(f"\n處理消息時發生錯誤: {e}")
            print("\n> ", end='', flush=True)

    def _on_error(self, ws, error):
        print(f"\nWebSocket 錯誤: {error}")
        print("\n> ", end='', flush=True)

    def _on_close(self, ws, close_status_code, close_msg):
        print("\nWebSocket 連接關閉")
        self.is_connected = False
        print("\n> ", end='', flush=True)

    def _on_open(self, ws):
        print("\nWebSocket 連接建立")
        self.is_connected = True
        print("\n> ", end='', flush=True)

    def wait_for_connection(self, timeout: int = 5) -> bool:
        start_time = time.time()
        while not self.is_connected and time.time() - start_time < timeout:
            time.sleep(0.1)
        return self.is_connected

    def close(self):
        if self.ws:
            self.ws.close()
            self.ws_thread.join(timeout=1)

class ChatClient:
    def __init__(self, base_url: str = "http://localhost:7581"):
        self.base_url = base_url.rstrip('/')
        self.token: Optional[str] = None
        self.ws_client: Optional[WebSocketClient] = None
        self.session_id: Optional[str] = None
        self._response_received = threading.Event()
        self._last_response_time = 0

    def connect(self) -> bool:
        """連接到伺服器並獲取 token"""
        try:
            # 檢查伺服器狀態
            response = requests.get(f"{self.base_url}/api/status")
            if response.status_code != 200:
                print(f"無法連接到伺服器: {response.status_code}")
                return False

            # 獲取 token
            response = requests.get(f"{self.base_url}/api/token")
            if response.status_code != 200:
                print("無法獲取 token")
                return False

            self.token = response.json()['token']
            return True
        except Exception as e:
            print(f"連接時發生錯誤: {e}")
            return False

    def create_session(self, initial_message: str) -> bool:
        """創建新的聊天會話"""
        if not self.token:
            print("尚未獲取 token")
            return False

        try:
            headers = {'Authorization': f'Bearer {self.token}'}
            data = {'text': initial_message}
            
            response = requests.post(
                f"{self.base_url}/api/chat/sessions",
                headers=headers,
                json=data
            )
            
            if response.status_code != 201:
                print(f"創建會話失敗: {response.status_code}")
                return False

            self.session_id = response.json()['sessionId']
            
            # 創建 WebSocket 連接
            ws_url = f"ws://localhost:7581?sessionId={self.session_id}"
            self.ws_client = WebSocketClient(ws_url, self.token)
            
            # 設置回覆接收事件的處理器
            self.ws_client.on_message_received = self._handle_message_received
            
            return self.ws_client.wait_for_connection()
        except Exception as e:
            print(f"創建會話時發生錯誤: {e}")
            return False

    def _handle_message_received(self, message_type: str):
        """處理收到的訊息"""
        if message_type == 'assistant':
            self._last_response_time = time.time()
            self._response_received.set()

    def wait_for_response(self, timeout: int = 60) -> bool:
        """等待助手的回覆"""
        self._response_received.clear()
        if self._response_received.wait(timeout):
            # 額外等待 1 秒，確保沒有更多的回覆
            time.sleep(1)
            if time.time() - self._last_response_time >= 1:
                return True
        return False

    def send_message(self, text: str) -> bool:
        """發送訊息到伺服器並等待回覆"""
        # 如果是第一條訊息，先創建會話
        if not self.session_id:
            if not self.create_session(text):
                return False
            return self.wait_for_response()

        try:
            headers = {'Authorization': f'Bearer {self.token}'}
            data = {'text': text}
            
            response = requests.post(
                f"{self.base_url}/api/chat/sessions/{self.session_id}/messages",
                headers=headers,
                json=data
            )
            
            if response.status_code != 200:
                return False
                
            # 等待回覆
            return self.wait_for_response()
        except Exception as e:
            print(f"發送訊息時發生錯誤: {e}")
            return False

    def close(self):
        """關閉連接"""
        if self.ws_client:
            self.ws_client.close()

def main():
    print("正在連接到聊天伺服器...")
    client = ChatClient()
    
    if not client.connect():
        print("無法連接到伺服器")
        return

    print("\n=== 聊天已開始 ===")
    print("你好，請問有什麼我可以幫你的嗎？")
    print("輸入 'exit' 結束對話")
    print("> ", end='', flush=True)

    try:
        while True:
            message = input()
            if message.lower() == 'exit':
                break
            
            if message.strip():
                if not client.send_message(message):
                    print("發送訊息失敗")
                    break
    except KeyboardInterrupt:
        print("\n接收到中斷信號，正在結束程式...")
    except Exception as e:
        print(f"\n發生錯誤: {e}")
    finally:
        print("\n正在關閉連接...")
        client.close()
        print("已結束對話")

if __name__ == "__main__":
    main() 