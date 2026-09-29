package com.transuai.gateway.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.upload.grpc.v1.NoteServiceGrpc;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import lombok.RequiredArgsConstructor;
import transuai.ai.v1.AiServiceGrpc;
import transuai.transcription.v1.TranscriptionServiceGrpc;

/**
 * 手動建立各下游服務的 ManagedChannel + blocking stub，不透過 spring-grpc 的
 * declarative client channel（{@code spring.grpc.client.channels.*}）—— 這裡只是單純的
 * 「呼叫固定位址的內部服務」，跟 Python 服務直接用 grpc.insecure_channel(target) 是同一種
 * 簡單模式，不需要額外的抽象層。plaintext（無 TLS）是因為目前所有服務都在同一個內部網路，
 * 跟其他服務之間的 gRPC 呼叫一致。
 */
@Configuration
@RequiredArgsConstructor
public class GrpcClientConfig {

    private final GrpcProperties properties;

    @Bean(destroyMethod = "shutdown")
    public ManagedChannel authServiceChannel() {
        return ManagedChannelBuilder.forTarget(properties.authServiceTarget()).usePlaintext().build();
    }

    @Bean(destroyMethod = "shutdown")
    public ManagedChannel uploadServiceChannel() {
        return ManagedChannelBuilder.forTarget(properties.uploadServiceTarget()).usePlaintext().build();
    }

    @Bean(destroyMethod = "shutdown")
    public ManagedChannel transcriptionServiceChannel() {
        return ManagedChannelBuilder.forTarget(properties.transcriptionServiceTarget()).usePlaintext().build();
    }

    @Bean(destroyMethod = "shutdown")
    public ManagedChannel aiServiceChannel() {
        return ManagedChannelBuilder.forTarget(properties.aiServiceTarget()).usePlaintext().build();
    }

    @Bean
    public AuthServiceGrpc.AuthServiceBlockingStub authServiceStub(ManagedChannel authServiceChannel) {
        return AuthServiceGrpc.newBlockingStub(authServiceChannel);
    }

    @Bean
    public UploadServiceGrpc.UploadServiceBlockingStub uploadServiceStub(ManagedChannel uploadServiceChannel) {
        return UploadServiceGrpc.newBlockingStub(uploadServiceChannel);
    }

    // 筆記（upload-service 的 NoteService）跟 Job 在同一個服務、同一條連線。
    @Bean
    public NoteServiceGrpc.NoteServiceBlockingStub noteServiceStub(ManagedChannel uploadServiceChannel) {
        return NoteServiceGrpc.newBlockingStub(uploadServiceChannel);
    }

    @Bean
    public TranscriptionServiceGrpc.TranscriptionServiceBlockingStub transcriptionServiceStub(
            ManagedChannel transcriptionServiceChannel) {
        return TranscriptionServiceGrpc.newBlockingStub(transcriptionServiceChannel);
    }

    @Bean
    public AiServiceGrpc.AiServiceBlockingStub aiServiceStub(ManagedChannel aiServiceChannel) {
        return AiServiceGrpc.newBlockingStub(aiServiceChannel);
    }
}
