import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalHttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message = 'Terjadi kesalahan internal pada server';
    let details: any = undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const res = exception.getResponse();
      error = exception.name;

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, any>;
        message = resObj.message || exception.message;
        if (Array.isArray(resObj.message)) {
          details = resObj.message.map((msg: string) => ({
            issue: msg,
          }));
          message = 'Validasi input gagal';
        } else if (resObj.details) {
          details = resObj.details;
        }
        if (resObj.error) {
          error = resObj.error;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Prisma error mappings
      if (exception.code === 'P2002') {
        statusCode = HttpStatus.CONFLICT;
        error = 'Conflict';
        message = 'Data dengan nilai unik tersebut sudah terdaftar';
        details = { target: exception.meta?.target };
      } else if (exception.code === 'P2025') {
        statusCode = HttpStatus.NOT_FOUND;
        error = 'Not Found';
        message = 'Data yang dicari tidak ditemukan';
      } else if (exception.code === 'P2003') {
        statusCode = HttpStatus.BAD_REQUEST;
        error = 'Bad Request';
        message = 'Relasi foreign key tidak valid atau data referensi tidak ditemukan';
      } else {
        statusCode = HttpStatus.BAD_REQUEST;
        error = 'Database Error';
        message = 'Operasi database gagal diproses';
      }
    } else {
      this.logger.error('Unhandled Exception caught:', exception);
    }

    const errorEnvelope = {
      success: false,
      statusCode,
      error,
      message,
      ...(details ? { details } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(statusCode).json(errorEnvelope);
  }
}
