import logging
import threading
from concurrent import futures

import grpc
from grpc_health.v1 import health, health_pb2, health_pb2_grpc
from grpc_reflection.v1alpha import reflection

from app.controllers.ai_controller import AiController
from app.core.config import settings
from app.core.production import check_secrets
from app.db import SessionLocal, init_db
from app.proto_gen import ai_pb2, ai_pb2_grpc
from app.services import job_deletion
from app.services.consumer import run_consumer
from app.services.deletion_consumer import run_deletion_consumer
from app.services.embedding_migration import sync_embeddings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


def build_server() -> grpc.Server:
    """AiService 加上 health check；開發環境另外開 reflection（方便用 grpcurl/Postman 除錯，跟 upload-service/transcription-service 一致），
    正式環境不開。"""
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    ai_pb2_grpc.add_AiServiceServicer_to_server(AiController(), server)

    health_servicer = health.HealthServicer()
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
    health_servicer.set("", health_pb2.HealthCheckResponse.SERVING)

    if not settings.is_production:
        reflection.enable_server_reflection(
            (
                ai_pb2.DESCRIPTOR.services_by_name["AiService"].full_name,
                health_pb2.DESCRIPTOR.services_by_name["Health"].full_name,
                reflection.SERVICE_NAME,
            ),
            server,
        )
    return server


def serve() -> None:
    check_secrets(settings)
    init_db()
    # 刪掉的 Job：刪除之後才寫進來的資料要丟掉（見 services/job_deletion）。
    job_deletion.guard_writes(SessionLocal)

    consumer_thread = threading.Thread(target=run_consumer, name="transcription-completed-consumer", daemon=True)
    consumer_thread.start()
    deletion_thread = threading.Thread(target=run_deletion_consumer, name="deletion-consumer", daemon=True)
    deletion_thread.start()
    logger.info("started RabbitMQ consumer threads")
    # 向量跟設定的 embedding 模型一致：換了模型就重算、缺的補算（見 services/embedding_migration）。
    threading.Thread(target=sync_embeddings, name="embedding-sync", daemon=True).start()

    server = build_server()
    server.add_insecure_port(f"[::]:{settings.grpc_port}")
    server.start()
    logger.info("gRPC server listening on port %s", settings.grpc_port)
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
