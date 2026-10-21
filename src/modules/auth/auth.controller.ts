import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Public } from '@/common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '@/common/decorators/current-user.decorator';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';

@ApiTags('Authentication & Identity')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login dengan email dan password' })
  @ApiResponse({ status: 200, description: 'Login berhasil, mengembalikan token akses & menyetel cookie refreshToken' })
  @ApiResponse({ status: 401, description: 'Email atau password salah' })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(loginDto);

    // Set secure httpOnly cookie for refresh token
    response.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    return {
      success: true,
      data: {
        user: result.user,
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
      },
    };
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrasi mandiri pengguna baru (SUPPLIER atau MITRA)' })
  @ApiResponse({ status: 201, description: 'Registrasi berhasil, mengembalikan token akses & menyetel cookie refreshToken' })
  @ApiResponse({ status: 400, description: 'Data pendaftaran tidak valid atau email sudah terdaftar' })
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.register(registerDto);

    response.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return {
      success: true,
      statusCode: 201,
      message: 'Pendaftaran akun berhasil',
      data: {
        user: result.user,
        accessToken: result.accessToken,
        expiresInSeconds: result.expiresInSeconds,
      },
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Perbarui access token menggunakan refresh token' })
  @ApiResponse({ status: 200, description: 'Token berhasil dirotasi' })
  @ApiResponse({ status: 401, description: 'Refresh token tidak valid atau telah kedaluwarsa' })
  async refresh(
    @Req() request: Request,
    @Body('refreshToken') bodyToken: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const rawToken = request.cookies?.refreshToken || bodyToken;
    const result = await this.authService.refreshTokens(rawToken);

    response.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return {
      success: true,
      data: {
        user: result.user,
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
      },
    };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer-token')
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout dan revokasi sesi pengguna' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const rawToken = request.cookies?.refreshToken;
    await this.authService.logout(user.id, rawToken);

    response.clearCookie('refreshToken', {
      httpOnly: true,
      path: '/api/v1/auth',
    });

    return {
      success: true,
      message: 'Sesi logout berhasil',
    };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer-token')
  @Get('me')
  @ApiOperation({ summary: 'Dapatkan profil pengguna terautentikasi saat ini' })
  @ApiResponse({ status: 200, description: 'Data profil berhasil diambil' })
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.authService.getMe(user.id);
    return {
      success: true,
      data: profile,
    };
  }
}
