import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { EmergencyRequestStatus } from '@prisma/client';

export class UpdateEmergencyStatusDto {
  @ApiProperty({
    example: 'FULFILLED',
    enum: EmergencyRequestStatus,
    description: 'Status baru permohonan darurat (biasanya FULFILLED atau CANCELLED)',
  })
  @IsEnum(EmergencyRequestStatus, { message: 'Status harus berupa nilai enum EmergencyRequestStatus yang valid' })
  @IsNotEmpty({ message: 'Status wajib diisi' })
  status!: EmergencyRequestStatus;

  @ApiPropertyOptional({
    example: 'Kebutuhan telah terpenuhi dari sumber dapur logistik lain',
    description: 'Alasan pembatalan (wajib jika status CANCELLED)',
  })
  @IsOptional()
  @IsString({ message: 'Alasan pembatalan harus berupa string' })
  cancelReason?: string;
}
