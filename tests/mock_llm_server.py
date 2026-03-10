"""
Mock LLM Server — Simulates multiple LLM endpoints for stress testing.

Runs 3 mock servers on ports 9001, 9002, 9003 simulating different LLM backends.
Each server responds to /v1/chat/completions, /v1/embeddings, /v1/rerank, /v1/models.

Features:
- Configurable latency (50-200ms random)
- Request counting per server
- Occasional 5xx errors (2% chance) to test failover
- Token counting simulation
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import time
import random
import threading
import json
import sys
import uuid

# Track stats per server
server_stats = {}

def create_app(port: int, server_name: str):
    app = Flask(__name__)
    CORS(app)

    stats = {"requests": 0, "errors": 0, "tokens": 0}
    server_stats[server_name] = stats

    @app.route("/v1/chat/completions", methods=["POST"])
    def chat_completions():
        stats["requests"] += 1

        # 2% chance of 5xx error to test failover
        if random.random() < 0.02:
            stats["errors"] += 1
            return jsonify({"error": {"message": "Internal server error", "type": "server_error"}}), 500

        # Simulate latency (50-200ms)
        time.sleep(random.uniform(0.05, 0.2))

        data = request.get_json(silent=True) or {}
        model = data.get("model", "unknown")
        messages = data.get("messages", [])
        stream = data.get("stream", False)

        input_tokens = sum(len(m.get("content", "").split()) * 2 for m in messages)
        output_tokens = random.randint(10, 200)
        stats["tokens"] += input_tokens + output_tokens

        if stream:
            def generate():
                chunk_id = f"chatcmpl-{uuid.uuid4().hex[:8]}"
                words = f"Response from {server_name} for model {model}".split()
                for i, word in enumerate(words):
                    chunk = {
                        "id": chunk_id,
                        "object": "chat.completion.chunk",
                        "created": int(time.time()),
                        "model": model,
                        "choices": [{
                            "index": 0,
                            "delta": {"content": word + " "} if i > 0 else {"role": "assistant", "content": word + " "},
                            "finish_reason": None
                        }]
                    }
                    yield f"data: {json.dumps(chunk)}\n\n"
                    time.sleep(0.01)

                # Final chunk
                final = {
                    "id": chunk_id,
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]
                }
                yield f"data: {json.dumps(final)}\n\n"
                yield "data: [DONE]\n\n"

            return app.response_class(generate(), mimetype="text/event-stream")

        return jsonify({
            "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model,
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": f"[{server_name}] Mock response for model={model}. Request #{stats['requests']}."
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": input_tokens,
                "completion_tokens": output_tokens,
                "total_tokens": input_tokens + output_tokens
            }
        })

    @app.route("/v1/embeddings", methods=["POST"])
    def embeddings():
        stats["requests"] += 1
        time.sleep(random.uniform(0.02, 0.1))

        data = request.get_json(silent=True) or {}
        input_text = data.get("input", "")
        if isinstance(input_text, list):
            input_text = " ".join(str(t) for t in input_text)

        tokens = len(str(input_text).split()) * 2
        stats["tokens"] += tokens

        return jsonify({
            "object": "list",
            "data": [{
                "object": "embedding",
                "embedding": [random.uniform(-1, 1) for _ in range(1536)],
                "index": 0
            }],
            "model": data.get("model", "text-embedding-ada-002"),
            "usage": {"prompt_tokens": tokens, "total_tokens": tokens}
        })

    @app.route("/v1/rerank", methods=["POST"])
    def rerank():
        stats["requests"] += 1
        time.sleep(random.uniform(0.02, 0.1))

        data = request.get_json(silent=True) or {}
        documents = data.get("documents", [])

        return jsonify({
            "results": [
                {"index": i, "relevance_score": random.uniform(0.1, 1.0)}
                for i in range(len(documents))
            ],
            "model": data.get("model", "rerank-v1"),
            "usage": {"prompt_tokens": len(documents) * 10, "total_tokens": len(documents) * 10}
        })

    @app.route("/v1/models", methods=["GET"])
    def models():
        return jsonify({
            "object": "list",
            "data": [
                {"id": "mock-gpt-4", "object": "model", "owned_by": server_name},
                {"id": "mock-claude", "object": "model", "owned_by": server_name},
            ]
        })

    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok", "server": server_name, "stats": stats})

    return app


def run_server(port: int, name: str):
    app = create_app(port, name)
    app.run(host="0.0.0.0", port=port, threaded=True, use_reloader=False)


if __name__ == "__main__":
    ports = [9001, 9002, 9003]

    print(f"Starting {len(ports)} mock LLM servers...")
    threads = []
    for port in ports:
        name = f"llm-server-{port}"
        t = threading.Thread(target=run_server, args=(port, name), daemon=True)
        t.start()
        threads.append(t)
        print(f"  {name} listening on :{port}")

    print("\nAll mock servers running. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(5)
            print("\n--- Server Stats ---")
            for name, stats in server_stats.items():
                print(f"  {name}: requests={stats['requests']}, errors={stats['errors']}, tokens={stats['tokens']}")
    except KeyboardInterrupt:
        print("\nShutting down mock servers.")
        sys.exit(0)
