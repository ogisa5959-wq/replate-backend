import { Module } from '@nestjs/common';
import { SurplusService } from './surplus.service';
import { SurplusController } from './surplus.controller';
import { SurplusExpiryWorker } from './surplus-expiry.worker';
import { JourneysModule } from '../journeys/journeys.module';

@Module({
  imports: [JourneysModule],
  controllers: [SurplusController],
  providers: [SurplusService, SurplusExpiryWorker],
  exports: [SurplusService, SurplusExpiryWorker],
})
export class SurplusModule {}

