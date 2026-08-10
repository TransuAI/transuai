import logging
import threading
from concurrent import futures

import grpc
from grpc_health.v1 import health, health_pb2, health_pb2_grpc
from grpc_reflection.v1alpha import reflection

from app.controllers.ai_controller import AiController
from app.core.config import settings
from app.db import init_db
from app.proto_gen import ai_pb2, ai_pb2_grpc
from app.services.consumer import run_consumer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


def serve() -> None:
    init_db()

    consumer_thread = threading.Thread(target=run_consumer, name="transcription-completed-consumer", daemon=True)
    consumer_thread.start()
    logger.info("started RabbitMQ consumer thread")

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=10))
    ai_pb2_grpc.add_AiServiceServicer_to_server(AiController(), server)

    health_servicer = health.HealthServicer()
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
    health_servicer.set("", health_pb2.HealthCheckResponse.SERVING)

    # 開發階段開放 reflection，方便用 grpcurl/Postman 除錯，跟 upload-service/transcription-service 一致。
    reflection.enable_server_reflection(
        (
            ai_pb2.DESCRIPTOR.services_by_name["AiService"].full_name,
            health_pb2.DESCRIPTOR.services_by_name["Health"].full_name,
            reflection.SERVICE_NAME,
        ),
        server,
    )

    server.add_insecure_port(f"[::]:{settings.grpc_port}")
    server.start()
    logger.info("gRPC server listening on port %s", settings.grpc_port)
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
