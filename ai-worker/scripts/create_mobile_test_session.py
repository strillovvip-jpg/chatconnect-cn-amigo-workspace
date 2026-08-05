"""Create an isolated two-phone Frame Echo test session and dispatch the worker."""

import asyncio
import json
import os
import urllib.parse
import uuid
from datetime import timedelta

from livekit import api


def require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def token(api_key: str, api_secret: str, room: str, identity: str, can_publish: bool) -> str:
    grants = api.VideoGrants(
        room_join=True,
        room=room,
        can_publish=can_publish,
        can_subscribe=True,
    )
    return (
        api.AccessToken(api_key, api_secret)
        .with_identity(identity)
        .with_name(identity)
        .with_ttl(timedelta(minutes=15))
        .with_grants(grants)
        .to_jwt()
    )


async def run() -> None:
    url = require_env("LIVEKIT_URL")
    api_key = require_env("LIVEKIT_API_KEY")
    api_secret = require_env("LIVEKIT_API_SECRET")
    agent_name = os.getenv("LIVEKIT_AGENT_NAME", "chatconnect-cn-frame-echo")
    test_page_url = os.getenv("MOBILE_TEST_PAGE_URL", "https://YOUR-HOST/mobile-echo-test")
    room = f"mobile-frame-echo-{uuid.uuid4().hex[:12]}"
    source_identity = f"mobile-source-{uuid.uuid4().hex[:8]}"
    receiver_identity = f"mobile-receiver-{uuid.uuid4().hex[:8]}"

    client = api.LiveKitAPI(url, api_key, api_secret)
    try:
        dispatch = await client.agent_dispatch.create_dispatch(
            api.CreateAgentDispatchRequest(agent_name=agent_name, room=room)
        )
    finally:
        await client.aclose()

    def page(role: str, jwt: str) -> str:
        query = urllib.parse.urlencode({"role": role, "url": url, "token": jwt})
        return f"{test_page_url}?{query}"

    print(
        json.dumps(
            {
                "room": room,
                "dispatch_id": dispatch.id,
                "phone_1_source_url": page(
                    "source", token(api_key, api_secret, room, source_identity, True)
                ),
                "phone_2_receiver_url": page(
                    "receiver", token(api_key, api_secret, room, receiver_identity, False)
                ),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    asyncio.run(run())
