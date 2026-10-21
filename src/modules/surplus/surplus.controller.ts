import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { SurplusService } from './surplus.service';
import { CreateSurplusDto } from './dto/create-surplus.dto';
import { UpdateSafetyParametersDto } from './dto/update-safety-parameters.dto';
import { JourneysService } from '../journeys/journeys.service';
import { AssignDestinationDto } from '../journeys/dto/assign-destination.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { Roles } from '@/common/decorators/roles.decorator';
import { CurrentUser, AuthenticatedUser } from '@/common/decorators/current-user.decorator';
import { UserRole, ListingLifecycleStatus, FoodCategory } from '@prisma/client';

@ApiTags('Surplus Food Listings & Safety Gate')
@ApiBearerAuth('bearer-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('surplus-listings')
export class SurplusController {
  constructor(
    private readonly surplusService: SurplusService,
    private readonly journeysService: JourneysService,
  ) {}

  @Post()
  @Roles(UserRole.SUPPLIER, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Laporkan surplus pangan baru dengan evaluasi Food Safety Gate server' })
  @ApiResponse({ status: 201, description: 'Surplus berhasil dicatat dan dievaluasi' })
  async create(
    @Body() dto: CreateSurplusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.surplusService.create(dto, user);
    return {
      success: true,
      message: 'Laporan surplus pangan berhasil dicatat',
      data: result,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Daftar seluruh surplus pangan dengan filter' })
  @ApiQuery({ name: 'status', enum: ListingLifecycleStatus, required: false })
  @ApiQuery({ name: 'category', enum: FoodCategory, required: false })
  async findAll(
    @Query('status') status?: ListingLifecycleStatus,
    @Query('category') category?: FoodCategory,
  ) {
    const listings = await this.surplusService.findAll({ status, category });
    return {
      success: true,
      data: listings,
    };
  }

  @Get('my-dispatches')
  @Roles(UserRole.SUPPLIER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Daftar pengiriman surplus aktif & riwayat milik donor yang login' })
  async getMyDispatches(@CurrentUser() user: AuthenticatedUser) {
    const dispatches = await this.surplusService.getMyDispatches(user);
    return {
      success: true,
      data: dispatches,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detail surplus pangan spesifik' })
  async findOne(@Param('id') id: string) {
    const listing = await this.surplusService.findOne(id);
    return {
      success: true,
      data: listing,
    };
  }

  @Get(':id/assessment')
  @ApiOperation({ summary: 'Ambil hasil evaluasi keselamatan pangan, Rescue Score, dan mitra cocok' })
  async getAssessment(@Param('id') id: string) {
    const assessment = await this.surplusService.getAssessment(id);
    return {
      success: true,
      data: assessment,
    };
  }

  @Get(':id/matches')
  @ApiOperation({ summary: 'Daftar mitra penampung cocok terurut jarak dan kapasitas' })
  async getMatches(@Param('id') id: string) {
    const matches = await this.surplusService.getMatches(id);
    return {
      success: true,
      data: matches,
    };
  }

  @Put(':id/safety-parameters')
  @Roles(UserRole.SUPPLIER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Evaluasi ulang parameter keselamatan jika berstatus REVIEW' })
  async updateSafetyParameters(
    @Param('id') id: string,
    @Body() dto: UpdateSafetyParametersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.surplusService.updateSafetyParameters(id, dto, user);
    return {
      success: true,
      data: result,
    };
  }

  @Post(':id/assign-destination')
  @Roles(UserRole.SUPPLIER, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Tetapkan mitra penampung dan kunci kuota kapasitas harian' })
  async assignDestination(
    @Param('id') id: string,
    @Body() dto: AssignDestinationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const journey = await this.journeysService.assignDestination(id, dto, user);
    return {
      success: true,
      message: 'Mitra berhasil ditetapkan dan kapasitas berhasil dicadangkan',
      data: journey,
    };
  }

  @Delete(':id')
  @Roles(UserRole.SUPPLIER, UserRole.ADMIN)
  @ApiOperation({ summary: 'Hapus laporan surplus dengan mekanisme soft delete (Tombstone)' })
  @ApiResponse({ status: 200, description: 'Laporan surplus berhasil dihapus' })
  @ApiResponse({ status: 400, description: 'Laporan surplus sudah terikat status logistik lanjutan' })
  @ApiResponse({ status: 404, description: 'Laporan surplus tidak ditemukan' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.surplusService.delete(id, user);
  }
}

