import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'news' },
  {
    path: 'news',
    loadComponent: () => import('./pages/news/news').then(m => m.NewsPage),
  },
  {
    path: 'predict',
    loadComponent: () => import('./pages/predict/predict').then(m => m.PredictPage),
  },
  {
    path: 'verify',
    loadComponent: () => import('./pages/verify/verify').then(m => m.VerifyPage),
  },
  {
    path: 'review',
    loadComponent: () => import('./pages/review/review').then(m => m.ReviewPage),
  },
  {
    path: 'settings',
    loadComponent: () => import('./pages/settings/settings').then(m => m.SettingsPage),
  },
];
