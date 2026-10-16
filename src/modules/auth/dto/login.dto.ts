import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@replate.id', description: 'Alamat email pengguna terdaftar' })
  @IsEmail({}, { message: 'Format email tidak valid' })
  @IsNotEmpty({ message: 'Email wajib diisi' })
  email!: string;

  @ApiProperty({ example: 'admin123', description: 'Kata sandi pengguna' })
  @IsString({ message: 'Password harus berupa string' })
  @IsNotEmpty({ message: 'Password wajib diisi' })
  @MinLength(6, { message: 'Password minimal 6 karakter' })
  password!: string;
}
