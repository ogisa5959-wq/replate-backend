import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from './common/decorators/public.decorator';

@ApiTags('System & Health')
@Controller()
export class AppController {
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Sistem REPLATE backend beroperasi normal' })
  getHealth() {
    return {
      status: 'ok',
      service: 'replate-backend',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  }
}
