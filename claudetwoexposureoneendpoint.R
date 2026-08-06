library(ggplot2)
library(ggquickeda)

effICGI <- logistic_data |>
  dplyr::filter(!is.na(ICGI))|>
  dplyr::filter(!is.na(AUC))
effICGI$DOSE <- factor(effICGI$DOSE,
                       levels=c("0", "600", "1200","1800","2400"),
                       labels=c("Placebo", "600 mg", "1200 mg","1800 mg","2400 mg"))
effICGI$STUDY <- factor(effICGI$STUDY)
effICGI$ICGI2 <- effICGI$ICGI
effICGI <- tidyr::gather(effICGI,Endpoint,response,ICGI,ICGI2)

effICGI <- logistic_data |>
  dplyr::filter(!is.na(ICGI))|>
  dplyr::filter(!is.na(AUC))
effICGI$DOSE <- factor(effICGI$DOSE,
                       levels=c("0", "600", "1200","1800","2400"),
                       labels=c("Placebo", "600 mg", "1200 mg","1800 mg","2400 mg"))
effICGI$STUDY <- factor(effICGI$STUDY)
effICGI$ICGI2 <- ifelse(effICGI$ICGI7 < 4,1,0)
effICGI$ICGI3 <- ifelse(effICGI$ICGI7 < 5,1,0)
#rite.csv(effICGI,"effICGIwide.csv",row.names = FALSE)
effICGI <- tidyr::gather(effICGI,Endpoint,response,ICGI,ICGI2,ICGI3)
# effICGI <- tidyr::gather(effICGI,exposuremetric,exposurevalue,AUC,CMAX)
# write.csv(effICGI,"effICGIlong.csv",row.names = FALSE)
effICGI$endpointcol2 <- effICGI$Endpoint
effICGI$endpointcol3 <- effICGI$Endpoint




ggresponseexpdist(data = effICGI |>
                    dplyr::filter(Endpoint%in%c("ICGI","ICGI2")),
                  points_show = TRUE,
                  exposure_metrics = c("AUC","CMAX"),
                  exposure_distribution_percent =  "N (%)",
                  exposure_distribution_Ntotal = "right",
                  exposure_distribution ="boxplots",
                  mean_obs_byexptile_group = "SEX",
                  
                  proj_bydose = TRUE,
                  yproj = TRUE,
                  mean_obs_bydose = TRUE,
                  mean_obs_byexptile = FALSE,
                  exposure_metric_split =  "tertile",
                  model_type = "logistic")+
  facet_wrap2(Endpoint~SEX+expname,scales="free_x",ncol=4,
              strip = strip_nested())


ggresponseexpdist(data = effICGI |>
                    dplyr::filter(Endpoint%in%c("ICGI","ICGI2")),
                  points_show = FALSE,
                  exposure_metrics = c("AUC"),
                  exposure_distribution ="distributions",
                  exposure_metric_split = "tertile",
                  color_fill = "endpointcol2",
                  model_type = "logistic",
                  fit_by_color_fill = TRUE,
                  mean_obs_byexptile_text_size = 3,
                  mean_obs_byexptile_group="endpointcol3",
                  facet_formula = Endpoint~expname,
                  N_byexptile_ypos = "none",
                  binlimits_text_size = 0
)


effICGI <- logistic_data |>
  dplyr::filter(!is.na(ICGI))|>
  dplyr::filter(!is.na(AUC))|>
dplyr::filter(!is.na(BRLS))|>
  dplyr::filter(!is.na(PRLS))

effICGI$DOSE <- factor(effICGI$DOSE,
                       levels=c("0", "600", "1200","1800","2400"),
                       labels=c("Placebo", "600 mg", "1200 mg","1800 mg","2400 mg"))
effICGI$STUDY <- factor(effICGI$STUDY)
effICGI$ICGI2 <- effICGI$ICGI
effICGI <- tidyr::gather(effICGI,Endpoint,response,BRLS,PRLS)



effICGI$endpointcol2 <- effICGI$Endpoint
effICGI$endpointcol3 <- effICGI$Endpoint


ggresponseexpdist(data = effICGI |>
                    dplyr::filter(Endpoint=="PRLS"),
                  model_type = "linear",
                  exposure_metrics = c("AUC","CMAX"),
                  legend_order = c("color","shape","model"),
                  proj_bydose = TRUE,
                  color_legend_title ="Dose\nLevels",
                  dist_position_scaler = 1, dist_offset = -1 ,
                  yproj_xpos =  -20 ,
                  yproj_dodge = 20
)


lung_long$auc <- lung_long$ph.karno
lung_long$cmax <- lung_long$pat.karno
lung_long$sex <- ifelse(lung_long$sex==1,"Male","Female")
ggkmrisktable(data = lung_long, time = "time", status = "DV",
              exposure_metrics =c("auc","cmax","age"),
              exposure_metric_split = "tertile",
              color_fill = "exptile",
              linetype = "exptile",
              groupvar1 = "Endpoint",
              groupvar2 = "expname",
              groupvar3= "sex",
              
              xlab = "Time of follow_up",
              ylab ="Overall survival probability",
              nrisk_table_variables = c("n.event","n.risk"),
              # km_trans = "event",
              km_median = "table",
              km_median_table_pos = "right",
              show_exptile_values = TRUE,
              
              km_logrank_pvalue = FALSE,
              km_logrank_pvalue_cutoff = 0.0001,
              km_logrank_pvalue_digits = 3,
              km_band = TRUE,
              nrisk_table_breaktimeby = 200,
              facet_ncol = 3,
              facet_formula = sex~expname)
