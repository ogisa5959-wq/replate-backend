import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'PasswordLama123!',
    description: 'Kata sandi saat ini untuk verifikasi keamanan',
  })
  @IsString({ message: 'Password saat ini harus berupa string' })
  @IsNotEmpty({ message: 'Password saat ini wajib diisi' })
  currentPassword!: string;

  @ApiProperty({
    example: 'PasswordBaru123!',
    description: 'Kata sandi baru (minimal 6 karakter)',
  })
  @IsString({ message: 'Password baru harus berupa string' })
  @IsNotEmpty({ message: 'Password baru wajib diisi' })
  @MinLength(6, { message: 'Password baru minimal 6 karakter' })
  newPassword!: string;
}
