import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { EmergencyService } from './emergency.service';
import { CreateEmergencyRequestDto } from './dto/create-emergency-request.dto';
import { AllocateEmergencyDto } from './dto/allocate-emergency.dto';
import { UpdateEmergencyStatusDto } from './dto/update-emergency-status.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '@/common/decorators/current-user.decorator';
import { UserRole, EmergencyRequestStatus, EmergencyUrgencyLevel } from '@prisma/client';

@ApiTags('Emergency Food Requisition')
@ApiBearerAuth('bearer-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('emergency-requests')
export class EmergencyController {
  constructor(private readonly emergencyService: EmergencyService) {}

  @Post()
  @Roles(UserRole.MITRA, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Buat permohonan bantuan pangan darurat baru' })
  @ApiResponse({ status: 201, description: 'Permohonan darurat berhasil dibuat' })
  async create(
    @Body() dto: CreateEmergencyRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const request = await this.emergencyService.create(dto, user);
    return {
      success: true,
      message: 'Permohonan bantuan pangan darurat berhasil dibuat',
      data: request,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Daftar permohonan pangan darurat aktif & riwayat' })
  @ApiQuery({ name: 'status', enum: EmergencyRequestStatus, required: false })
  @ApiQuery({ name: 'urgencyLevel', enum: EmergencyUrgencyLevel, required: false })
  async findAll(
    @Query('status') status?: EmergencyRequestStatus,
    @Query('urgencyLevel') urgencyLevel?: EmergencyUrgencyLevel,
  ) {
    const requests = await this.emergencyService.findAll({ status, urgencyLevel });
    return {
      success: true,
      data: requests,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail permohonan pangan darurat spesifik' })
  async findOne(@Param('id') id: string) {
    const request = await this.emergencyService.findOne(id);
    return {
      success: true,
      data: request,
    };
  }

  @Get(':id/matching-surplus')
  @Roles(UserRole.MITRA, UserRole.ADMIN)
  @ApiOperation({ summary: 'Daftar kandidat surplus aktif yang lolos Food Safety Gate PASS' })
  async findMatchingSurplus(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const matches = await this.emergencyService.findMatchingSurplus(id, user);
    return {
      success: true,
      data: matches,
    };
  }

  @Post(':id/allocate')
  @Roles(UserRole.MITRA, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Alokasikan surplus donor ke permohonan darurat secara atomik' })
  @ApiResponse({ status: 200, description: 'Surplus berhasil dialokasikan ke permohonan darurat' })
  @ApiResponse({ status: 422, description: 'Surplus tidak lolos Food Safety Gate PASS' })
  async allocate(
    @Param('id') id: string,
    @Body() dto: AllocateEmergencyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.emergencyService.allocate(id, dto, user);
  }

  @Patch(':id/status')
  @Roles(UserRole.MITRA, UserRole.ADMIN)
  @ApiOperation({ summary: 'Perbarui status permohonan pangan darurat (FULFILLED / CANCELLED)' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateEmergencyStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.emergencyService.updateStatus(id, dto, user);
    return {
      success: true,
      data: updated,
    };
  }

  @Delete(':id')
  @Roles(UserRole.MITRA, UserRole.ADMIN)
  @ApiOperation({ summary: 'Hapus permohonan darurat dengan mekanisme soft delete (Tombstone)' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.emergencyService.delete(id, user);
  }
}
