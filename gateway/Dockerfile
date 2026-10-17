# Build context 必須是 transuai/（repo 的根目錄），因為 build.gradle 用
# srcDir '../infra/proto' 讀 proto 定義：
#   docker build -f gateway/Dockerfile -t transuai/gateway:dev .
FROM eclipse-temurin:26-jdk AS build

WORKDIR /workspace
COPY infra/proto infra/proto

COPY gateway/gradlew gateway/gradlew.bat gateway/build.gradle gateway/settings.gradle gateway/
COPY gateway/gradle gateway/gradle
COPY gateway/src gateway/src

WORKDIR /workspace/gateway
RUN ./gradlew bootJar -x test --no-daemon

FROM eclipse-temurin:26-jre
WORKDIR /app
COPY --from=build /workspace/gateway/build/libs/*.jar app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
