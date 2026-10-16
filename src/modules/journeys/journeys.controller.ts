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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JourneysService } from './journeys.service';
import { AdvanceStatusDto } from './dto/advance-status.dto';
import { ConfirmReceiptDto } from './dto/confirm-receipt.dto';
import { CancelJourneyDto } from './dto/cancel-journey.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '@/common/decorators/current-user.decorator';
import { UserRole, JourneyStatus } from '@prisma/client';

@ApiTags('Rescue Journeys & Logistics')
@ApiBearerAuth('bearer-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('journeys')
export class JourneysController {
  constructor(private readonly journeysService: JourneysService) {}

  @Get()
  @ApiOperation({ summary: 'Daftar perjalanan penyelamatan makanan' })
  @ApiQuery({ name: 'status', enum: JourneyStatus, required: false })
  @ApiQuery({ name: 'recipientId', required: false })
  @ApiQuery({ name: 'donorId', required: false })
  async findAll(
    @Query('status') status: JourneyStatus,
    @Query('recipientId') recipientId: string,
    @Query('donorId') donorId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const journeys = await this.journeysService.findAll({ status, recipientId, donorId }, user);
    return {
      success: true,
      data: journeys,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail perjalanan dan garis waktu pelacakan logistik' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const journey = await this.journeysService.findOne(id, user);
    return {
      success: true,
      data: journey,
    };
  }

  @Patch(':id/advance-status')
  @Roles(UserRole.SUPPLIER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Majukan status perjalanan ke RESCUE_INITIATED (serah terima kurir)' })
  async advanceStatus(
    @Param('id') id: string,
    @Body() dto: AdvanceStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.journeysService.advanceStatus(id, dto, user);
    return {
      success: true,
      message: 'Status perjalanan berhasil dimajukan ke RESCUE_INITIATED',
      data: updated,
    };
  }

  @Post(':id/confirm-receipt')
  @Roles(UserRole.MITRA, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Konfirmasi serah terima fisik makanan di lokasi mitra penerima (RECEIVED)' })
  async confirmReceipt(
    @Param('id') id: string,
    @Body() dto: ConfirmReceiptDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.journeysService.confirmReceipt(id, dto, user);
    return {
      success: true,
      message: 'Serah terima fisik berhasil dikonfirmasi',
      data: updated,
    };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batalkan perjalanan / Laporkan penolakan fisik di lokasi mitra (Doorstep Rejection)' })
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelJourneyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.journeysService.cancel(id, dto, user);
    return {
      success: true,
      message: result.message,
      data: result,
    };
  }
}
