import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { Public } from '@/common/decorators/public.decorator';

@ApiTags('Rescue Performance & Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Public()
  @Get('performance')
  @ApiOperation({ summary: 'Metrik kinerja rantai pasok perkotaan & KPI dampak lingkungan' })
  @ApiQuery({ name: 'lang', required: false, enum: ['id', 'en'] })
  async getPerformance(@Query('lang') lang?: 'id' | 'en') {
    const data = await this.analyticsService.getPerformance(lang || 'id');
    return {
      success: true,
      data,
    };
  }

  @Public()
  @Get('insights')
  @ApiOperation({ summary: 'Wawasan pencegahan surplus dan pola makanan berulang' })
  @ApiQuery({ name: 'lang', required: false, enum: ['id', 'en'] })
  async getInsights(@Query('lang') lang?: 'id' | 'en') {
    const data = await this.analyticsService.getInsights(lang || 'id');
    return {
      success: true,
      data,
    };
  }
}
