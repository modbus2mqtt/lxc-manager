import { NgZone, OnDestroy, Component, OnInit, inject, Input, Output, EventEmitter } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';

import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { CommonModule } from '@angular/common';
import { IVeExecuteMessagesResponse } from '../../shared/types';
import { VeConfigurationService } from '../ve-configuration.service';

@Component({
  selector: 'app-process-monitor',
  standalone: true,
  imports: [CommonModule, MatTooltipModule, MatExpansionModule],
  templateUrl: './process-monitor.html',
  styleUrl: './process-monitor.scss',
})
export class ProcessMonitor implements OnInit, OnDestroy {
  messages: IVeExecuteMessagesResponse| undefined;
  private destroyed = false;
  private pollInterval?: number;
  private veConfigurationService = inject(VeConfigurationService);
  private queryParamSub?: Subscription;
   
  @Input() restartKey?: string;
  @Output() restartRequested = new EventEmitter<string>();

  private zone = inject(NgZone);
  private route = inject(ActivatedRoute);

  ngOnInit() {
    // Subscribe to query param changes to get restartKey when it becomes available
    this.queryParamSub = this.route.queryParamMap.subscribe(params => {
      const key = params.get('restartKey');
      if (key) this.restartKey = key;
    });
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
    this.queryParamSub?.unsubscribe();
  }

  startPolling() {
    this.pollInterval = setInterval(() => {
      this.veConfigurationService.getExecuteMessages().subscribe({
        next: (msgs) => {
          if (msgs && msgs.length > 0) {
            this.zone.run(() => {
              this.mergeMessages(msgs);
            });
          }
        },
        error: () => {
          // Optionally handle error
        }
      });
    }, 5000);
  }

  private mergeMessages(newMsgs: IVeExecuteMessagesResponse) {
    if (!this.messages) {
      this.messages = [...newMsgs];
      return;
    }
    
    for (const newGroup of newMsgs) {
      const existing = this.messages.find(
        g => g.application === newGroup.application && g.task === newGroup.task
      );
      if (existing) {
        // Append only new messages (by index)
        const existingIndices = new Set(existing.messages.map(m => m.index));
        for (const msg of newGroup.messages) {
          if (!existingIndices.has(msg.index)) {
            existing.messages.push(msg);
          }
        }
      } else {
        // Add new application/task group
        this.messages.push({ ...newGroup });
      }
    }
  }

  triggerRestart() {
    if (this.restartKey) {
      this.restartRequested.emit(this.restartKey);
    }
  }

}