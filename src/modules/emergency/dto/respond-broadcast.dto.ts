import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RespondBroadcastDto {
  @ApiPropertyOptional({
    example: 'Makanan baru matang 30 menit lalu, dikemas dalam kotak higienis siap antar',
    description: 'Catatan kondisi makanan darurat dari penyedia surplus',
  })
  @IsOptional()
  @IsString({ message: 'Catatan harus berupa string' })
  notes?: string;
}
