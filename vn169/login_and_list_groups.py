import csv
import json
import os
from getpass import getpass
from pathlib import Path

from telethon import TelegramClient


SESSION_NAME = "main_account_session"
OUTPUT_FILE = "telegram_groups.csv"
CONFIG_FILE = Path("telegram_config.json")


def load_saved_config() -> dict:
    if CONFIG_FILE.exists():
        with CONFIG_FILE.open("r", encoding="utf-8") as file:
            return json.load(file)
    return {}


def save_config(api_id: int, api_hash: str, phone: str) -> None:
    with CONFIG_FILE.open("w", encoding="utf-8") as file:
        json.dump(
            {
                "api_id": api_id,
                "api_hash": api_hash,
                "phone": phone,
            },
            file,
            ensure_ascii=True,
            indent=2,
        )


def get_value(saved: dict, env_name: str, prompt_text: str, secret: bool = False) -> str:
    env_value = os.getenv(env_name)
    if env_value:
        return env_value.strip()

    saved_value = saved.get(env_name.lower().replace("telegram_", ""))
    if saved_value:
        return str(saved_value).strip()

    if secret:
        return getpass(prompt_text).strip()
    return input(prompt_text).strip()


def login_once(client: TelegramClient, phone: str) -> None:
    if client.is_user_authorized():
        return

    client.send_code_request(phone)
    code = input("Nhap ma xac minh Telegram: ").strip()

    try:
        client.sign_in(phone=phone, code=code)
    except Exception as exc:
        # Telethon raises if 2FA password is enabled.
        if "password" not in str(exc).lower():
            raise
        password = getpass("Nhap mat khau 2FA Telegram: ").strip()
        client.sign_in(password=password)


def main() -> None:
    saved = load_saved_config()
    api_id = int(get_value(saved, "TELEGRAM_API_ID", "Nhap TELEGRAM_API_ID: "))
    api_hash = get_value(saved, "TELEGRAM_API_HASH", "Nhap TELEGRAM_API_HASH: ", secret=True)
    phone = get_value(saved, "TELEGRAM_PHONE", "Nhap so dien thoai Telegram, vd +8490xxxxxxx: ")

    with TelegramClient(SESSION_NAME, api_id, api_hash) as client:
        login_once(client, phone)
        save_config(api_id, api_hash, phone)

        groups = []

        for dialog in client.iter_dialogs():
            entity = dialog.entity
            is_group = dialog.is_group
            is_supergroup = bool(getattr(entity, "megagroup", False))

            if not (is_group or is_supergroup):
                continue

            groups.append(
                {
                    "name": dialog.name,
                    "id": dialog.id,
                    "username": getattr(entity, "username", "") or "",
                    "type": "supergroup" if is_supergroup else "group",
                }
            )

        print("\nDanh sach group Telegram:\n")
        for group in groups:
            username = f"@{group['username']}" if group["username"] else ""
            print(f"{group['name']} | id={group['id']} | type={group['type']} | {username}")

        with open(OUTPUT_FILE, "w", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=["name", "id", "username", "type"])
            writer.writeheader()
            writer.writerows(groups)

        print(f"\nDa luu {len(groups)} group vao {OUTPUT_FILE}")
        print(f"Da luu session vao {SESSION_NAME}.session va cau hinh vao {CONFIG_FILE}")


if __name__ == "__main__":
    main()
