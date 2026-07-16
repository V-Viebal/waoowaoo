"""ElevenLabs TTS through the LLM360 credential gateway.

Studio360 stores an LLM360 credential id, not the provider secret. The LLM360 API
resolves that credential server-side and proxies the ElevenLabs request. PCM output
is wrapped as WAV because Studio360 resources use the ``.wav`` suffix.
"""

from __future__ import annotations

import io
import logging
import os
import uuid
import wave
from urllib.parse import quote

import httpx

from lib.audio_backends.base import (
    AudioCapability,
    AudioSynthesisRequest,
    AudioSynthesisResult,
)
from lib.providers import PROVIDER_ELEVENLABS

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "eleven_multilingual_v2"
DEFAULT_GATEWAY_URL = "https://api-llm360.hmz.one"
_PCM_SAMPLE_RATE = 24_000


def _gateway_url(base_url: str | None) -> str:
    return (base_url or os.getenv("LLM360_ELEVENLABS_BASE_URL") or DEFAULT_GATEWAY_URL).rstrip("/")


def _service_api_key(value: str | None) -> str | None:
    if value and value.strip():
        return value.strip()
    for name in (
        "LLM360_CONTROL_PLANE_SERVICE_API_KEY",
        "LLM360_EDGE_SERVICE_API_KEY",
        "LLM360_SERVICE_API_KEY",
        "LLM360_VAULT_KEY",
    ):
        candidate = os.getenv(name)
        if candidate and candidate.strip():
            return candidate.strip()
    return None


def _wav_from_pcm(pcm: bytes) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(_PCM_SAMPLE_RATE)
        wav.writeframes(pcm)
    return output.getvalue()


class Llm360ElevenLabsAudioBackend:
    """ElevenLabs TTS backend using an LLM360 credential id as ``api_key``."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
        service_api_key: str | None = None,
        http_timeout: float = 120.0,
    ) -> None:
        if not api_key or not api_key.strip():
            raise ValueError("LLM360 ElevenLabs requires an LLM360 credential id in api_key")
        try:
            self._credential_id = str(uuid.UUID(api_key.strip()))
        except ValueError as exc:
            raise ValueError("LLM360 ElevenLabs api_key must be an LLM360 credential UUID") from exc
        self._model = model or DEFAULT_MODEL
        self._base_url = _gateway_url(base_url)
        self._service_api_key = _service_api_key(service_api_key)
        if not self._service_api_key:
            raise ValueError("An LLM360 service API key is required for ElevenLabs gateway access")
        self._http_timeout = http_timeout

    @property
    def name(self) -> str:
        return PROVIDER_ELEVENLABS

    @property
    def model(self) -> str:
        return self._model

    @property
    def capabilities(self) -> set[AudioCapability]:
        return {AudioCapability.TEXT_TO_SPEECH}

    async def synthesize(self, request: AudioSynthesisRequest) -> AudioSynthesisResult:
        payload = {
            "text": request.text,
            "model_id": self._model,
            "output_format": "pcm_24000",
        }
        if request.speed is not None:
            logger.debug("ElevenLabs gateway backend does not map speed=%s; provider default is used", request.speed)

        encoded_voice = quote(request.voice, safe="")
        url = f"{self._base_url}/api/elevenlabs/credentials/{self._credential_id}/text-to-speech/{encoded_voice}"
        headers = {"X-Service-Api-Key": self._service_api_key, "Accept": "audio/pcm"}
        logger.info(
            "调用 %s 语音合成 API model=%s voice=%s chars=%d",
            self.name,
            self._model,
            request.voice,
            len(request.text),
        )
        async with httpx.AsyncClient(timeout=self._http_timeout) as client:
            response = await client.post(url, json=payload, headers=headers)

        if response.status_code >= 400:
            detail = response.text.strip()[:500]
            raise RuntimeError(f"LLM360 ElevenLabs gateway failed with HTTP {response.status_code}: {detail}")
        if not response.content:
            raise RuntimeError("LLM360 ElevenLabs gateway returned an empty audio response")

        content_type = response.headers.get("content-type", "")
        audio = response.content if "wav" in content_type else _wav_from_pcm(response.content)
        request.output_path.write_bytes(audio)
        return AudioSynthesisResult(
            provider=PROVIDER_ELEVENLABS,
            model=self._model,
            characters=len(request.text),
            output_path=request.output_path,
        )
