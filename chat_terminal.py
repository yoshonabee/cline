import requests
import json
import websocket
import threading
import time
import os
import traceback
from typing import Optional, Dict, Any, List, Callable
from enum import Enum, auto


class ChatStatus(Enum):
    IDLE = auto()
    STREAMING = auto()
    COMPLETED = auto()
    ERROR = auto()


class WebSocketClient:
    def __init__(self, url: str, session_id: str, token: str, message_handler):
        self.url = url
        self.session_id = session_id
        self.token = token
        self.message_handler = message_handler
        self.ws = None
        self._connect()

    def _connect(self):
        """連接到 WebSocket 伺服器"""
        try:
            headers = {"Authorization": f"Bearer {self.token}"}
            self.ws = websocket.WebSocketApp(
                f"{self.url}?sessionId={self.session_id}",
                header=headers,
                on_message=self._on_message,
                on_error=self._on_error,
                on_close=self._on_close,
                on_open=self._on_open,
            )
            # 在背景執行 WebSocket
            threading.Thread(target=self.ws.run_forever, daemon=True).start()
        except Exception as e:
            print(f"WebSocket 連接失敗: {e}")

    def _on_message(self, ws, message):
        """處理收到的 WebSocket 消息"""
        try:
            if self.message_handler:
                self.message_handler(message)
        except Exception as e:
            print(f"處理 WebSocket 消息時發生錯誤: {e}")

    def _on_error(self, ws, error):
        """處理 WebSocket 錯誤"""
        print(f"WebSocket 錯誤: {error}")

    def _on_close(self, ws, close_status_code, close_msg):
        """處理 WebSocket 連接關閉"""
        print("WebSocket 連接已關閉")

    def _on_open(self, ws):
        """處理 WebSocket 連接開啟"""
        print("WebSocket 連接已建立")

    def close(self):
        """關閉 WebSocket 連接"""
        if self.ws:
            self.ws.close()


class ChatClient:
    def __init__(self, base_url: str = "http://localhost:7581"):
        self.base_url = base_url
        self.session_id = None
        self.token = None
        self.ws_client = None
        self._is_complete = False
        self._response_received = threading.Event()
        self._last_response_time = 0
        self._last_content = ""

    def _handle_message_received(self, message_str):
        """處理收到的 WebSocket 消息"""
        try:
            message = json.loads(message_str)

            if message.get("message"):
                print(message["message"])

        except json.JSONDecodeError:
            print("無法解析 WebSocket 消息")
        except Exception as e:
            print(f"處理 WebSocket 消息時發生錯誤: {e}")

    def create_session(self, message: str, images: Optional[List[str]] = None) -> bool:
        """創建新的聊天會話"""
        try:
            # 獲取 token
            response = requests.get(f"{self.base_url}/api/token")
            if response.status_code != 200:
                print(f"獲取 token 失敗: {response.status_code}")
                return False
            self.token = response.json()["token"]

            # 創建會話
            headers = {"Authorization": f"Bearer {self.token}"}
            data = {"text": message}
            if images:
                data["images"] = images

            response = requests.post(
                f"{self.base_url}/api/chat/sessions", headers=headers, json=data
            )

            if response.status_code != 201:
                print(f"創建會話失敗: {response.status_code}")
                return False

            self.session_id = response.json()["sessionId"]

            # 連接 WebSocket
            return self._connect_websocket()

        except Exception as e:
            print(f"創建會話時發生錯誤: {e}")
            return False

    def send_message(self, message: str, images: Optional[List[str]] = None) -> bool:
        """發送訊息到現有會話"""
        if not self.session_id or not self.token:
            print("尚未創建會話")
            return False

        try:
            headers = {"Authorization": f"Bearer {self.token}"}
            data = {"text": message}
            if images:
                data["images"] = images

            response = requests.post(
                f"{self.base_url}/api/chat/sessions/{self.session_id}/messages",
                headers=headers,
                json=data,
            )

            if response.status_code != 200:
                print(f"發送訊息失敗: {response.status_code}")
                return False

            # 等待回應完成
            return self.wait_for_response()

        except Exception as e:
            print(f"發送訊息時發生錯誤: {e}")
            return False

    def _connect_websocket(self) -> bool:
        """連接到 WebSocket"""
        try:
            ws_url = f"ws://localhost:7581"
            self.ws_client = WebSocketClient(
                ws_url, self.session_id, self.token, self._handle_message_received
            )
            return True
        except Exception as e:
            print(f"WebSocket 連接失敗: {e}")
            return False

    def wait_for_response(self, timeout: int = 60) -> bool:
        """等待回應完成"""
        self._is_complete = False
        self._response_received.clear()

        try:
            # 等待回應完成或超時
            if not self._response_received.wait(timeout):
                print("\n等待回應超時")
                return False

            return True

        except KeyboardInterrupt:
            print("\n使用者中斷等待")
            return False

    def close(self):
        """關閉客戶端連接"""
        if self.ws_client:
            self.ws_client.close()


def main():
    """主程式"""
    client = ChatClient()

    try:
        # 讀取用戶輸入並創建會話
        message = input("請輸入訊息: ")
        if not message:
            print("訊息不能為空")
            return

        if not client.create_session(message):
            print("創建會話失敗")
            return

        # 持續讀取用戶輸入
        while True:
            message = input("\n> ")
            if not message:
                continue

            if message.lower() in ["exit", "quit", "q"]:
                break

            if not client.send_message(message):
                print("發送訊息失敗")
                break

    except KeyboardInterrupt:
        print("\n程式已中斷")
    finally:
        client.close()


if __name__ == "__main__":
    main()
