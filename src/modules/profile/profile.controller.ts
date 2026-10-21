import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '@/common/decorators/current-user.decorator';

@ApiTags('User Profile & Account Settings')
@ApiBearerAuth('bearer-token')
@UseGuards(JwtAuthGuard)
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @ApiOperation({
    summary:
      'Dapatkan informasi profil lengkap pengguna, organisasi, dan koordinat geospasial',
  })
  @ApiResponse({
    status: 200,
    description: 'Data profil pengguna berhasil dimuat',
  })
  async getProfile(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.profileService.getProfile(user.id);
    return {
      success: true,
      statusCode: HttpStatus.OK,
      data,
    };
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Perbarui identitas pengguna, kontak, alamat, koordinat geospasial (Latitude/Longitude), dan spesifikasi mitra',
  })
  @ApiResponse({
    status: 200,
    description: 'Profil berhasil diperbarui',
  })
  @ApiResponse({
    status: 400,
    description: 'Data masukan tidak valid',
  })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ) {
    const data = await this.profileService.updateProfile(user.id, dto);
    return {
      success: true,
      statusCode: HttpStatus.OK,
      message: 'Profil dan koordinat geospasial berhasil diperbarui',
      data,
    };
  }

  @Put('password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Ubah kata sandi akun dengan verifikasi kata sandi lama via Argon2id',
  })
  @ApiResponse({
    status: 200,
    description: 'Kata sandi berhasil diperbarui',
  })
  @ApiResponse({
    status: 401,
    description: 'Kata sandi saat ini tidak sesuai',
  })
  @ApiResponse({
    status: 400,
    description: 'Kata sandi baru tidak memenuhi syarat',
  })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ) {
    const result = await this.profileService.changePassword(user.id, dto);
    return {
      statusCode: HttpStatus.OK,
      ...result,
    };
  }
}
