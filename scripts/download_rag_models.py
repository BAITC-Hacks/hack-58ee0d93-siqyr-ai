"""Explicit one-time download of local RAG weights; never called by the API runtime."""
import argparse
import json
from pathlib import Path

from huggingface_hub import HfApi, snapshot_download

from backend.app.config import Settings
from backend.app.rag import EMBED_MODEL, RERANK_MODEL

FILES = [
    "*.json", "*.model", "*.safetensors", "modules.json", "1_Pooling/*",
]


def download(repo_id: str, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    revision = HfApi().model_info(repo_id).sha
    snapshot_download(repo_id=repo_id, revision=revision, local_dir=str(destination), allow_patterns=FILES)
    if not (destination / "model.safetensors").is_file():
        raise RuntimeError(f"Model weights missing in {destination}")
    (destination / "rag-model.json").write_text(json.dumps({"repo_id": repo_id, "revision": revision}, indent=2) + "\n", encoding="utf-8")
    print(f"{repo_id} @ {revision} -> {destination}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--embedding-only", action="store_true")
    parser.add_argument("--reranker-only", action="store_true")
    args = parser.parse_args()
    if args.embedding_only and args.reranker_only:
        parser.error("Choose only one model filter")
    settings = Settings()
    if not args.reranker_only:
        download(EMBED_MODEL, settings.rag_embedding_dir)
    if not args.embedding_only:
        download(RERANK_MODEL, settings.rag_reranker_dir)
