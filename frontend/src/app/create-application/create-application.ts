import { Component, OnInit, signal, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormControl } from '@angular/forms';
import { MatStepperModule } from '@angular/material/stepper';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { VeConfigurationService } from '../ve-configuration.service';
import { ErrorHandlerService } from '../shared/services/error-handler.service';
import { IFrameworkName, IParameter, IParameterValue } from '../../shared/types';
import { ParameterGroupComponent } from '../ve-configuration-dialog/parameter-group.component';

@Component({
  selector: 'app-create-application',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatStepperModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatCardModule,
    ParameterGroupComponent
  ],
  templateUrl: './create-application.html',
  styleUrl: './create-application.scss'
})
export class CreateApplication implements OnInit {
  private fb = inject(FormBuilder);
  private configService = inject(VeConfigurationService);
  private router = inject(Router);
  private errorHandler = inject(ErrorHandlerService);

  // Step 1: Framework selection
  frameworks: IFrameworkName[] = [];
  selectedFramework: IFrameworkName | null = null;
  loadingFrameworks = signal(true);

  // Step 2: Application properties
  appPropertiesForm: FormGroup = this.fb.group({
    name: ['', [Validators.required]],
    applicationId: ['', [Validators.required, Validators.pattern(/^[a-z0-9-]+$/)]],
    description: ['', [Validators.required]]
  });

  // Step 3: Parameters
  parameters: IParameter[] = [];
  parameterForm: FormGroup = this.fb.group({});
  groupedParameters: Record<string, IParameter[]> = {};
  showAdvanced = signal(false);
  loadingParameters = signal(false);

  // Step 4: Summary
  creating = signal(false);

  ngOnInit(): void {
    this.loadFrameworks();
  }

  loadFrameworks(): void {
    this.loadingFrameworks.set(true);
    this.configService.getFrameworkNames().subscribe({
      next: (res) => {
        this.frameworks = res.frameworks;
        this.loadingFrameworks.set(false);
      },
      error: (err) => {
        this.errorHandler.handleError('Failed to load frameworks', err);
        this.loadingFrameworks.set(false);
      }
    });
  }

  onFrameworkSelected(frameworkId: string): void {
    this.selectedFramework = this.frameworks.find(f => f.id === frameworkId) || null;
    if (this.selectedFramework) {
      this.loadParameters(frameworkId);
    }
  }

  loadParameters(frameworkId: string): void {
    this.loadingParameters.set(true);
    this.parameters = [];
    this.parameterForm = this.fb.group({});
    this.groupedParameters = {};

    this.configService.getFrameworkParameters(frameworkId).subscribe({
      next: (res) => {
        this.parameters = res.parameters;
        // Group parameters by template (or use 'General' as default)
        this.groupedParameters = {};
        for (const param of this.parameters) {
          const group = param.templatename || 'General';
          if (!this.groupedParameters[group]) {
            this.groupedParameters[group] = [];
          }
          this.groupedParameters[group].push(param);
          
          const validators = param.required ? [Validators.required] : [];
          const defaultValue = param.default !== undefined ? param.default : '';
          this.parameterForm.addControl(param.id, new FormControl(defaultValue, validators));
        }
        // Sort parameters in each group: required first, then optional
        for (const group in this.groupedParameters) {
          this.groupedParameters[group] = this.groupedParameters[group].slice().sort(
            (a, b) => Number(!!b.required) - Number(!!a.required)
          );
        }
        this.loadingParameters.set(false);
      },
      error: (err) => {
        this.errorHandler.handleError('Failed to load framework parameters', err);
        this.loadingParameters.set(false);
      }
    });
  }

  toggleAdvanced(): void {
    this.showAdvanced.set(!this.showAdvanced());
  }

  hasAdvancedParams(): boolean {
    return this.parameters.some(p => p.advanced);
  }

  get groupNames(): string[] {
    return Object.keys(this.groupedParameters);
  }

  canProceedToStep2(): boolean {
    return this.selectedFramework !== null;
  }

  canProceedToStep3(): boolean {
    if (this.appPropertiesForm.invalid) {
      this.appPropertiesForm.markAllAsTouched();
      return false;
    }
    return true;
  }

  canProceedToStep4(): boolean {
    if (this.parameterForm.invalid) {
      this.parameterForm.markAllAsTouched();
      return false;
    }
    return true;
  }

  createApplication(): void {
    if (!this.selectedFramework || this.appPropertiesForm.invalid || this.parameterForm.invalid) {
      return;
    }

    this.creating.set(true);

    const parameterValues: { id: string; value: IParameterValue }[] = [];
    for (const param of this.parameters) {
      const value = this.parameterForm.get(param.id)?.value;
      if (value !== null && value !== undefined && value !== '') {
        parameterValues.push({ id: param.id, value });
      }
    }

    const body = {
      frameworkId: this.selectedFramework.id,
      applicationId: this.appPropertiesForm.get('applicationId')?.value,
      name: this.appPropertiesForm.get('name')?.value,
      description: this.appPropertiesForm.get('description')?.value,
      parameterValues
    };

    this.configService.createApplicationFromFramework(body).subscribe({
      next: (res) => {
        this.creating.set(false);
        if (res.success) {
          alert(`Application "${body.name}" created successfully!`);
          this.router.navigate(['/applications']);
        } else {
          alert('Failed to create application');
        }
      },
      error: (err) => {
        this.errorHandler.handleError('Failed to create application', err);
        this.creating.set(false);
      }
    });
  }

  cancel(): void {
    this.router.navigate(['/applications']);
  }
}

