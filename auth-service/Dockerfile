# Build context 必須是 transuai/（repo 們的共同上層目錄），因為 build.gradle 用
# srcDir '../infra/proto' 讀 proto 定義：
#   docker build -f auth-service/Dockerfile -t transuai/auth-service:dev .
FROM eclipse-temurin:26-jdk AS build

WORKDIR /workspace
COPY infra/proto infra/proto

# 明確列出需要的子路徑，不整包 COPY auth-service，避免把 .git/.gradle/build 等
# 本機產物也帶進 image（.dockerignore 對這種「context 在上層目錄」的 build 不會生效）。
COPY auth-service/gradlew auth-service/gradlew.bat auth-service/build.gradle auth-service/settings.gradle auth-service/
COPY auth-service/gradle auth-service/gradle
COPY auth-service/src auth-service/src

WORKDIR /workspace/auth-service
RUN ./gradlew bootJar -x test --no-daemon

FROM eclipse-temurin:26-jre
WORKDIR /app
COPY --from=build /workspace/auth-service/build/libs/*.jar app.jar

EXPOSE 8081 9091
ENTRYPOINT ["java", "-jar", "app.jar"]
