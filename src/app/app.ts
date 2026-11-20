import { Component, inject, signal, OnInit } from '@angular/core';
import { RouterOutlet, RouterLink, Router } from '@angular/router';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { StoreService } from './services/store.service';
import { ApiService } from './services/api.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  readonly store = inject(StoreService);
  readonly api = inject(ApiService);
  readonly router = inject(Router);
  private readonly updates = inject(SwUpdate);

  readonly updateReady = signal(false);
  readonly tabs = [
    { path: '/news', label: '新闻', icon: 'K' },
    { path: '/predict', label: '预判', icon: 'P' },
    { path: '/verify', label: '验证', icon: 'V' },
    { path: '/review', label: '复盘', icon: 'R' },
  ];

  ngOnInit(): void {
    if (!this.updates.isEnabled) return;
    this.updates.versionUpdates.pipe(
      filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY')
    ).subscribe(() => this.updateReady.set(true));
  }

  applyUpdate(): void {
    this.updates.activateUpdate().then(() => document.location.reload());
  }

  seedDemo(): void {
    this.store.seedDemo();
    this.router.navigateByUrl('/predict');
  }
}
