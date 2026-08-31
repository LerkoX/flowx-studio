#!/usr/bin/env python3
import requests
import json
import sys
import os

# 从环境变量获取配置
APP_ID = os.getenv("FEISHU_APP_ID", "")
APP_SECRET = os.getenv("FEISHU_APP_SECRET", "")
CHAT_ID = os.getenv("FEISHU_CHAT_ID", "")
TITLE = os.getenv("FEISHU_TITLE", "通知") or "通知"
CONTENT = os.getenv("FEISHU_CONTENT", "")

def get_access_token(app_id, app_secret):
    """获取 tenant_access_token"""
    url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
    headers = {"Content-Type": "application/json"}
    data = {
        "app_id": app_id,
        "app_secret": app_secret
    }
    response = requests.post(url, headers=headers, json=data)
    result = response.json()
    if result.get("code") != 0:
        raise Exception(f"获取 token 失败: {result}")
    return result.get("tenant_access_token")

def send_card_message(token, chat_id, title, text_content):
    """发送卡片消息到群聊（正文支持 lark_md Markdown）"""
    url = "https://open.feishu.cn/open-apis/im/v1/messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    params = {"receive_id_type": "chat_id"}

    card_content = {
        "config": {
            "wide_screen_mode": True
        },
        "header": {
            "template": "blue",
            "title": {
                "content": title,
                "tag": "plain_text"
            }
        },
        "elements": [
            {
                "tag": "div",
                "text": {
                    "content": text_content,
                    "tag": "lark_md"
                }
            }
        ]
    }

    data = {
        "receive_id": chat_id,
        "msg_type": "interactive",
        "content": json.dumps(card_content, ensure_ascii=False)
    }

    response = requests.post(url, headers=headers, params=params, json=data)
    return response.json()

def main():
    print("准备发送飞书通知...")
    print()

    # 验证配置
    if not APP_ID:
        print("警告: 飞书 AppID 未配置")
        sys.exit(1)

    if not APP_SECRET:
        print("警告: 飞书 AppSecret 未配置")
        sys.exit(1)

    if not CHAT_ID:
        print("警告: 飞书群聊ID 未配置")
        sys.exit(1)

    if not CONTENT:
        print("警告: 消息内容 content 为空")
        sys.exit(1)

    print(f"标题: {TITLE}")
    print(f"消息内容长度: {len(CONTENT)} 字符")
    print(f"消息内容:\n{CONTENT}")
    print()

    try:
        # 获取 token
        token = get_access_token(APP_ID, APP_SECRET)
        print("Token 获取成功")

        # 发送消息
        result = send_card_message(token, CHAT_ID, TITLE, CONTENT)

        if result.get("code") == 0:
            print("✅ 消息发送成功！")
            print('```flowx-yaml')
            print('status: success')
            print('```')
        else:
            print(f"❌ 消息发送失败: {result}")
            sys.exit(1)

    except Exception as e:
        print(f"发送失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
