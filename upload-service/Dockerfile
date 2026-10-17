# Build context 必須是 transuai/（repo 們的共同上層目錄），因為 build.gradle 用
# srcDir '../infra/proto' 讀 proto 定義：
#   docker build -f upload-service/Dockerfile -t transuai/upload-service:dev .
FROM eclipse-temurin:26-jdk AS build

WORKDIR /workspace
COPY infra/proto infra/proto

COPY upload-service/gradlew upload-service/gradlew.bat upload-service/build.gradle upload-service/settings.gradle upload-service/
COPY upload-service/gradle upload-service/gradle
COPY upload-service/src upload-service/src

WORKDIR /workspace/upload-service
RUN ./gradlew bootJar -x test --no-daemon

FROM eclipse-temurin:26-jre
WORKDIR /app
COPY --from=build /workspace/upload-service/build/libs/*.jar app.jar

EXPOSE 8082 9090
ENTRYPOINT ["java", "-jar", "app.jar"]
