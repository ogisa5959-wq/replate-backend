import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { SimulationService } from './simulation.service';
import { PrismaModule } from '@/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AdminController],
  providers: [SimulationService],
  exports: [SimulationService],
})
export class AdminModule {}
