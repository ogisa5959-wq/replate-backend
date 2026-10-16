import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min } from 'class-validator';

export class AdvanceStatusDto {
  @ApiPropertyOptional({ example: 'Makanan telah diserahkan kepada kurir relawan', description: 'Catatan progres' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ example: 25, description: 'Estimasi waktu perjalanan dalam menit' })
  @IsOptional()
  @IsInt()
  @Min(1)
  estimatedTransitMinutes?: number;
}
