import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CapacityService } from './capacity.service';
import { PrismaService } from '@/prisma/prisma.service';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '@/common/decorators/current-user.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('Recipient Partners & Capacity Management')
@ApiBearerAuth('bearer-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('recipients')
export class RecipientsController {
  constructor(
    private readonly capacityService: CapacityService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('my-capacity')
  @Roles(UserRole.MITRA, UserRole.ADMIN)
  @ApiOperation({ summary: 'Dapatkan status kapasitas harian untuk mitra penerima yang login' })
  @ApiResponse({ status: 200, description: 'Data kapasitas harian berhasil diambil' })
  async getMyCapacity(@CurrentUser() user: AuthenticatedUser) {
    const capacity = await this.capacityService.getMyCapacity(user.organizationId);
    return {
      success: true,
      data: capacity,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Daftar seluruh mitra penerima terdaftar' })
  async findAll() {
    const recipients = await this.prisma.recipientProfile.findMany({
      include: {
        organization: true,
      },
    });

    return {
      success: true,
      data: recipients,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail profil mitra penerima spesifik' })
  async findOne(@Param('id') id: string) {
    const recipient = await this.prisma.recipientProfile.findUnique({
      where: { id },
      include: {
        organization: true,
        capacities: true,
      },
    });

    return {
      success: true,
      data: recipient,
    };
  }
}
