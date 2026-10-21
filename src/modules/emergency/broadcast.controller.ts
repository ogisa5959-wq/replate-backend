import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { BroadcastService } from './broadcast.service';
import { RespondBroadcastDto } from './dto/respond-broadcast.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '@/common/decorators/current-user.decorator';
import { UserRole, BroadcastStatus } from '@prisma/client';

@ApiTags('Emergency Broadcasts (SOS)')
@ApiBearerAuth('bearer-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('emergency-broadcasts')
export class BroadcastController {
  constructor(private readonly broadcastService: BroadcastService) {}

  @Get('active')
  @Roles(UserRole.SUPPLIER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Daftar siaran darurat SOS aktif untuk penyedia surplus (filter radius < 20 km)' })
  @ApiQuery({ name: 'latitude', required: false, type: Number, description: 'Koordinat lintang opsional' })
  @ApiQuery({ name: 'longitude', required: false, type: Number, description: 'Koordinat bujur opsional' })
  @ApiResponse({ status: 200, description: 'Daftar siaran SOS aktif terdekat' })
  async findActive(
    @CurrentUser() user: AuthenticatedUser,
    @Query('latitude') latitude?: string,
    @Query('longitude') longitude?: string,
  ) {
    const latNum = latitude !== undefined && latitude !== '' ? parseFloat(latitude) : undefined;
    const lonNum = longitude !== undefined && longitude !== '' ? parseFloat(longitude) : undefined;
    const queryCoords =
      latNum !== undefined && lonNum !== undefined && !isNaN(latNum) && !isNaN(lonNum)
        ? { latitude: latNum, longitude: lonNum }
        : undefined;

    const broadcasts = await this.broadcastService.findActive(user, queryCoords);
    return {
      success: true,
      data: broadcasts,
    };
  }

  @Get('my-responses')
  @Roles(UserRole.SUPPLIER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Riwayat respons bantuan SOS oleh penyedia surplus' })
  @ApiResponse({ status: 200, description: 'Riwayat respons bantuan SOS' })
  async findMyResponses(@CurrentUser() user: AuthenticatedUser) {
    const responses = await this.broadcastService.findMyResponses(user);
    return {
      success: true,
      data: responses,
    };
  }

  @Post(':broadcastId/respond')
  @Roles(UserRole.SUPPLIER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Konfirmasi bantuan darurat oleh penyedia surplus' })
  @ApiResponse({ status: 200, description: 'Bantuan darurat berhasil dikonfirmasi' })
  async respond(
    @Param('broadcastId', new ParseUUIDPipe({ version: '4' })) broadcastId: string,
    @Body() dto: RespondBroadcastDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.broadcastService.respondToBroadcast(broadcastId, dto, user);
  }

  @Patch(':broadcastId/status')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Ubah status siaran darurat (Khusus Admin)' })
  @ApiResponse({ status: 200, description: 'Status siaran darurat berhasil diubah' })
  async updateStatus(
    @Param('broadcastId', new ParseUUIDPipe({ version: '4' })) broadcastId: string,
    @Body('status') status: BroadcastStatus,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.broadcastService.updateStatus(broadcastId, status, user);
    return {
      success: true,
      data: updated,
    };
  }
}
