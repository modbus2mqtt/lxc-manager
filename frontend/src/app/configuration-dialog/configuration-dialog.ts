import { Component, Input, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProxmoxConfigurationService } from '../ve-configuration.service';
import { ISsh } from '../../shared/types.mjs';

@Component({
  selector: 'app-configuration-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './configuration-dialog.html',
  styleUrl: './configuration-dialog.scss',
})
export class ConfigurationDialog implements OnInit {
  @Input() sshMode = false;
  @Output() dialogClose = new EventEmitter<void>();
  @Output() saved = new EventEmitter<ISsh>();

  ssh: ISsh = { host: '', port: 22 };
  loading = false;
  error = '';

  configService = inject(ProxmoxConfigurationService);

  ngOnInit() {
    if (this.sshMode) {
      this.loading = true;
      this.configService.getSshConfig().subscribe({
        next: ssh => { this.ssh = ssh; this.loading = false; },
        error: () => { this.error = 'Fehler beim Laden der SSH-Konfiguration.'; this.loading = false; }
      });
    }
  }

  save() {
    this.loading = true;
    this.configService.setSshConfig(this.ssh).subscribe({
      next: () => { this.loading = false; this.saved.emit(this.ssh); this.dialogClose.emit(); },
      error: () => { this.error = 'Fehler beim Speichern.'; this.loading = false; }
    });
  }

  cancel() {
    this.dialogClose.emit();
  }
}
