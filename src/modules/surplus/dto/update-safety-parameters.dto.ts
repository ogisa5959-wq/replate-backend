import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsNumber } from 'class-validator';

export class UpdateSafetyParametersDto {
  @ApiPropertyOptional({ example: 'no_visible_damage' })
  @IsOptional()
  @IsString()
  safetyConditionId?: string;

  @ApiPropertyOptional({ example: 'known_compliant' })
  @IsOptional()
  @IsString()
  storageHistoryId?: string;

  @ApiPropertyOptional({ example: 'hot_holding_above_60' })
  @IsOptional()
  @IsString()
  storageTempId?: string;

  @ApiPropertyOptional({ example: 'intact_proper' })
  @IsOptional()
  @IsString()
  packagingConditionId?: string;

  @ApiPropertyOptional({ example: 'hygienic_separated' })
  @IsOptional()
  @IsString()
  handlingIntegrityId?: string;

  @ApiPropertyOptional({ example: 65.0 })
  @IsOptional()
  @IsNumber()
  storageTemperatureC?: number;

  @ApiPropertyOptional({ example: 'Kondisi telah diverifikasi ulang oleh staf dapur' })
  @IsOptional()
  @IsString()
  reVerificationNotes?: string;
}
