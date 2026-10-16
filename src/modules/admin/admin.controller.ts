import {
  Controller,
  Post,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SimulationService } from './simulation.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '@/common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Admin & Simulation')
@ApiBearerAuth('bearer-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/simulation')
export class AdminController {
  constructor(private readonly simulationService: SimulationService) {}

  @Roles(UserRole.ADMIN)
  @Post('load-demo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Memuat dataset simulasi demo untuk evaluasi prototipe' })
  @ApiResponse({ status: 200, description: 'Dataset simulasi demo berhasil dimuat' })
  async loadDemo(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.simulationService.loadDemoData(user.id);
    return {
      success: true,
      data: result,
    };
  }

  @Roles(UserRole.ADMIN)
  @Delete('clear-demo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Membersihkan dataset simulasi demo tanpa menghapus data donasi asli' })
  @ApiResponse({ status: 200, description: 'Dataset simulasi demo berhasil dibersihkan' })
  async clearDemo(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.simulationService.clearDemoData(user.id);
    return {
      success: true,
      data: result,
    };
  }
}
