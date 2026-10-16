import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { GlobalHttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const port = process.env.PORT || 3000;
  const apiPrefix = process.env.API_PREFIX || '/api/v1';
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  app.setGlobalPrefix(apiPrefix.replace(/^\//, ''));

  // Cookie Parser
  app.use(cookieParser());

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global Exception Filter (RFC 7807 Envelope)
  app.useGlobalFilters(new GlobalHttpExceptionFilter());

  // CORS Configuration
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  // OpenAPI / Swagger Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('REPLATE API')
    .setDescription('Platform Redistribusi Surplus Pangan — REST API Specification')
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Masukkan JWT Bearer Token',
        in: 'header',
      },
      'bearer-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port);
  logger.log(`🚀 REPLATE Backend running on: http://localhost:${port}/${apiPrefix.replace(/^\//, '')}`);
  logger.log(`📚 OpenAPI / Swagger documentation at: http://localhost:${port}/api/docs`);
}

bootstrap();
