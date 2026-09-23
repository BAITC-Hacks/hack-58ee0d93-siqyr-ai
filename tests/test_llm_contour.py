"""RAG and the protocol pipeline accept the same LLM locations: loopback or hosts listed in LLM_ALLOWED_HOSTS."""
from backend.app.config import Settings
from backend.app.readiness import llm_in_contour


def settings(url: str, provider: str = "local", allowed: list[str] | None = None) -> Settings:
    return Settings(llm_provider=provider, llm_base_url=url, llm_allowed_hosts=allowed or [])


def test_loopback_llm_is_in_contour():
    assert llm_in_contour(settings("http://127.0.0.1:11434/v1"))
    assert llm_in_contour(settings("http://localhost:11434/v1"))


def test_allowed_self_hosted_llm_is_in_contour():
    # The Ollama container of docker compose, a vLLM server of the customer's network.
    assert llm_in_contour(settings("http://ollama:11434/v1", allowed=["ollama"]))
    assert llm_in_contour(settings("http://gpu01:8000/v1", allowed=["ollama", "gpu01"]))


def test_other_hosts_cloud_and_empty_endpoint_are_rejected():
    assert not llm_in_contour(settings("http://ollama:11434/v1"))
    assert not llm_in_contour(settings("http://gpu02:8000/v1", allowed=["gpu01"]))
    assert not llm_in_contour(settings("https://api.openai.com/v1", provider="dev_openai"))
    assert not llm_in_contour(settings("http://127.0.0.1:11434/v1", provider="dev_openai"))
    assert not llm_in_contour(settings(""))
