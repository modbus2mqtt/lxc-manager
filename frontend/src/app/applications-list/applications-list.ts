
import { Component, inject, OnInit } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ProxmoxConfigurationDialog } from '../proxmox-configuration-dialog/proxmox-configuration-dialog';
import { CommonModule } from '@angular/common';
import { ProxmoxConfigurationService } from '../proxmox-configuration.service';
import { IApplicationWeb } from '../../shared/types.mjs';

interface IApplicationWebIntern extends IApplicationWeb{
  showErrors?: boolean;
}
@Component({
  selector: 'app-applications-list',
  standalone: true,
  imports: [CommonModule, MatDialogModule],
  templateUrl: './applications-list.html',
  styleUrl: './applications-list.scss',
})

export class ApplicationsList implements OnInit {
  applications: IApplicationWebIntern[] = [];
  loading = true;
  error?: string;
  private proxmoxService = inject(ProxmoxConfigurationService);
  private dialog = inject(MatDialog);

  openProxmoxConfigDialog(app: IApplicationWeb) {
    this.dialog.open(ProxmoxConfigurationDialog, {
      data: { app },
    });
  }

  ngOnInit(): void {
    this.proxmoxService.getApplications().subscribe({
      next: (apps) => {
        this.applications = apps.map((app) => ({ ...app, showErrors: false }));
        this.loading = false;
      },
      error: () => {
        this.error = 'Error loading applications';
        this.loading = false;
      }
    });
  }
}
